const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fetch: undiciFetch, Agent } = require('undici');
const { getResponseMetadata } = require('./response-metadata');
const { openAiResponseFormat, applyBedrockStructuredOutput } = require('./structured-output');
const { assertPayloadWithinLimit, normalizeMaxApiPayload } = require('./payload-budget');

function getDatabase() {
    return require('../../database');
}

// undici's default 300s headersTimeout aborts slow local generations
// (stream:false sends headers only when generation finishes). 30 min ceiling.
const generationDispatcher = new Agent({
    headersTimeout: 1_800_000,
    bodyTimeout: 1_800_000
});

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.gif': return 'image/gif';
        default: return 'image/jpeg';
    }
}

// gpt-5 and o-series reject max_tokens; matched by name so new variants are covered.
function needsMaxCompletionTokens(model) {
    if (!model) return false;
    // Strip a provider prefix like "openai/" (OpenRouter uses vendor-slugged ids).
    const m = model.toLowerCase().split('/').pop();
    return m.startsWith('gpt-5') || /^o[1-9]($|[-.])/.test(m);
}

// Reasoning models count thinking inside the output limit, so they get headroom on top.
// Only generated tokens are billed, so unused headroom is free.
const REASONING_OUTPUT_HEADROOM = 8192;
const GEMINI_MAX_OUTPUT_TOKENS = 65536;
const DEFAULT_OUTPUT_TOKENS = 1000;

function isGeminiThinkingModel(model) {
    if (!model) return false;
    const m = String(model).toLowerCase().split('/').pop();
    return /^gemini-(?:2\.5|[3-9])(?:[.-]|$)/.test(m);
}

// Excludes reasoning headroom, which would block small-limit workspaces.
function requestedOutputTokens(maxTokens) {
    return Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0
        ? Math.floor(Number(maxTokens))
        : DEFAULT_OUTPUT_TOKENS;
}

// The output limit actually sent to the provider.
function providerOutputLimit(provider, model, maxTokens) {
    const requested = requestedOutputTokens(maxTokens);
    const normalizedProvider = String(provider || '').toLowerCase();
    if (['openai', 'openrouter', 'local'].includes(normalizedProvider) && needsMaxCompletionTokens(model)) {
        return requested + REASONING_OUTPUT_HEADROOM;
    }
    if (['google ai', 'vertex ai'].includes(normalizedProvider) && isGeminiThinkingModel(model)) {
        return Math.min(GEMINI_MAX_OUTPUT_TOKENS, requested + REASONING_OUTPUT_HEADROOM);
    }
    return requested;
}

// The effective limit is the smaller of the connection window and the workspace limit.
function connectionContextWindow(apiProfile) {
    const value = Number(apiProfile?.contextWindow);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function payloadLimitFor(apiProfile, maxPayloadTokens) {
    const workspace = maxPayloadTokens == null ? null : normalizeMaxApiPayload(maxPayloadTokens);
    const connection = connectionContextWindow(apiProfile);
    if (connection !== null && (workspace === null || normalizeMaxApiPayload(connection) < workspace)) {
        return { limit: normalizeMaxApiPayload(connection), source: 'connection' };
    }
    return { limit: workspace, source: 'workspace' };
}

function loadApiProfile(apiProfileId, dependencies = {}) {
    const db = dependencies.database || getDatabase();
    try {
        return db.prepare('SELECT * FROM api_profiles WHERE id = ?').get(apiProfileId) || null;
    } catch (e) {
        return null;
    }
}

// Budget math outside this module must measure exactly what buildRequest checks.
function resolvePayloadLimit({ apiProfileId, maxPayloadTokens }, dependencies = {}) {
    return payloadLimitFor(loadApiProfile(apiProfileId, dependencies), maxPayloadTokens);
}

function getReservedOutputTokens({ maxTokens }) {
    return requestedOutputTokens(maxTokens);
}

// Workspace variables ({{name}}) are expanded before a request is measured or sent.
function createPromptVariableResolver(database) {
    let variables = [];
    try {
        variables = database.prepare('SELECT key, value FROM variables').all().map(variable => ({
            regex: new RegExp(`\\{\\{\\s*${String(variable.key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'),
            value: String(variable.value ?? '')
        }));
    } catch (e) {
        console.error("Error resolving dynamic variables:", e);
    }
    return (text) => {
        if (!text || !variables.length) return text;
        let result = text;
        for (const variable of variables) result = result.replace(variable.regex, () => variable.value);
        return result;
    };
}

// Accepts a bare base (.../v1) or a full endpoint. kind = 'chat' | 'embeddings'.
function resolveEndpoint(baseUrl, kind) {
    if (!baseUrl) return null;
    const want = kind === 'embeddings' ? '/embeddings' : '/chat/completions';
    const other = kind === 'embeddings' ? '/chat/completions' : '/embeddings';
    const trimmed = baseUrl.replace(/\/+$/, '');
    if (trimmed.endsWith(want)) return trimmed;
    if (trimmed.endsWith(other)) return trimmed.slice(0, -other.length) + want;
    return trimmed + want;
}

function resolveOpenAiCompatibleEndpoint(baseUrl, provider, kind) {
    const normalizedProvider = String(provider || '').toLowerCase();
    const customEndpoint = resolveEndpoint(String(baseUrl || '').trim(), kind);
    if (customEndpoint) return customEndpoint;
    if (normalizedProvider === 'local') {
        throw new Error("Local API connections require a Base URL, such as http://127.0.0.1:5001/v1.");
    }
    if (normalizedProvider === 'openrouter') {
        return `https://openrouter.ai/api/v1/${kind === 'embeddings' ? 'embeddings' : 'chat/completions'}`;
    }
    return `https://api.openai.com/v1/${kind === 'embeddings' ? 'embeddings' : 'chat/completions'}`;
}

function buildOpenAiCompatibleHeaders(apiKey) {
    const headers = { "Content-Type": "application/json" };
    const normalizedKey = String(apiKey || '').trim();
    if (normalizedKey) headers.Authorization = `Bearer ${normalizedKey}`;
    return headers;
}

async function readHttpErrorMessage(response) {
    const fallback = response.statusText || `HTTP ${response.status}`;
    let body = '';
    try {
        body = (await response.text()).trim();
    } catch {
        return fallback;
    }
    if (!body) return fallback;
    try {
        const data = JSON.parse(body);
        return data?.error?.message || data?.message || body;
    } catch {
        return body;
    }
}

// --- AUTHENTICATION & SIGNING HELPERS ---

async function getGcpAccessToken(serviceAccountJsonStr) {
    if (!serviceAccountJsonStr) {
        throw new Error("GCP Service Account JSON is empty.");
    }
    const sa = JSON.parse(serviceAccountJsonStr);
    const jwtHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");

    const nowSecs = Math.floor(Date.now() / 1000);
    const jwtClaim = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSecs + 3600,
        iat: nowSecs
    })).toString("base64url");

    const signatureInput = `${jwtHeader}.${jwtClaim}`;
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature = sign.sign(sa.private_key, "base64url");

    const assertion = `${signatureInput}.${signature}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new Error(`GCP OAuth Token exchange failed: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
}

// AWS SigV4 Signing helper
function hmac(key, string, encoding) {
    return crypto.createHmac("sha256", key).update(string).digest(encoding);
}

function hash(string) {
    return crypto.createHash("sha256").update(string).digest("hex");
}

function awsSignV4({ accessKeyId, secretAccessKey, region, service, method, path, headers, body }) {
    const amzDate = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substr(0, 8);

    headers["x-amz-date"] = amzDate;
    headers["x-amz-content-sha256"] = hash(body);

    const canonicalUri = path;
    const canonicalQueryString = "";

    const sortedHeaderNames = Object.keys(headers).map(h => h.toLowerCase()).sort();
    const canonicalHeaders = sortedHeaderNames.map(h => {
        const originalName = Object.keys(headers).find(k => k.toLowerCase() === h);
        return `${h}:${headers[originalName].toString().trim()}`;
    }).join("\n") + "\n";

    const signedHeaders = sortedHeaderNames.join(";");
    const payloadHash = hash(body);

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        hash(canonicalRequest)
    ].join("\n");

    const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, "aws4_request");
    const signature = hmac(kSigning, stringToSign, "hex");

    headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// --- RESPONSE PARSING ---

// jsonMode never prepends reasoning: braces inside it break object extraction.
// A withheld or unreadable reply throws; an empty one returns '' so callers can tell an
// exhausted output budget from a failure.
function parseResponse(data, provider, jsonMode = false) {
    const withReasoning = (reasoning, content) => (reasoning && !jsonMode ? `<think>${reasoning}</think>${content}` : content);
    switch (provider.toLowerCase()) {
        case 'openai':
        case 'openrouter':
        case 'local': {
            if (data?.error) throw responseError(`The provider returned an error: ${providerErrorMessage(data.error)}`, 'PROVIDER_ERROR');
            const choice = data?.choices?.[0];
            const message = choice?.message;
            if (!message) throw responseError('The provider response contained no message.', 'MALFORMED_RESPONSE');
            const content = typeof message.content === 'string' ? message.content : textOfParts(message.content, false);
            if (!content && message.refusal) throw responseError(`The model declined to answer: ${message.refusal}`, 'MODEL_REFUSAL');
            if (!content && String(choice.finish_reason || '').toUpperCase() === 'CONTENT_FILTER') {
                throw responseError('The provider filtered this reply (content_filter).', 'PROVIDER_BLOCKED');
            }
            return withReasoning(message.reasoning_content || message.reasoning, content);
        }
        case 'anthropic': {
            if (data?.type === 'error' || data?.error) throw responseError(`The provider returned an error: ${providerErrorMessage(data.error)}`, 'PROVIDER_ERROR');
            if (!Array.isArray(data?.content)) throw responseError('The provider response contained no content.', 'MALFORMED_RESPONSE');
            const text = data.content.filter(block => block?.type === 'text').map(block => block.text || '').join('');
            const thinking = data.content.filter(block => block?.type === 'thinking').map(block => block.thinking || '').join('');
            if (!text && String(data.stop_reason || '').toUpperCase() === 'REFUSAL') {
                throw responseError('The model declined to answer.', 'MODEL_REFUSAL');
            }
            return withReasoning(thinking, text);
        }
        case 'google ai':
        case 'vertex ai': {
            if (data?.error) throw responseError(`The provider returned an error: ${providerErrorMessage(data.error)}`, 'PROVIDER_ERROR');
            const candidate = data?.candidates?.[0];
            if (!candidate) {
                const blockReason = data?.promptFeedback?.blockReason;
                throw blockReason
                    ? responseError(`The provider blocked this prompt (${blockReason}).`, 'PROVIDER_BLOCKED')
                    : responseError('The provider response contained no candidates.', 'MALFORMED_RESPONSE');
            }
            const parts = candidate.content?.parts;
            const text = textOfParts(parts, false);
            const reason = String(candidate.finishReason || '').toUpperCase();
            if (!text && BLOCKING_FINISH_REASONS.has(reason)) {
                throw responseError(`The provider stopped this reply (${reason}).`, 'PROVIDER_BLOCKED');
            }
            return withReasoning(textOfParts(parts, true), text);
        }
        case 'aws bedrock': {
            if (Array.isArray(data?.content)) {
                return data.content.filter(block => typeof block?.text === 'string').map(block => block.text).join('');
            }
            if (typeof data?.generation === 'string') return data.generation;
            throw responseError('The AWS Bedrock response had an unexpected format.', 'MALFORMED_RESPONSE');
        }
        default:
            throw responseError(`Responses from the provider '${provider}' cannot be read.`, 'MALFORMED_RESPONSE');
    }
}

// Finish reasons that mean the provider withheld the reply, as opposed to cutting
// it short at the output limit.
const BLOCKING_FINISH_REASONS = new Set([
    'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE', 'OTHER'
]);

function responseError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function providerErrorMessage(error) {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    return error.message || error.status || JSON.stringify(error);
}

function textOfParts(parts, thoughts) {
    return (Array.isArray(parts) ? parts : [])
        .filter(part => Boolean(part?.thought) === thoughts)
        .map(part => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
}

// Stateless: the reader handles line splitting, `data:` and [DONE].
// finishReason and error let streaming treat cut-off or failed replies like the non-streaming path.
function parseStreamChunk(obj, provider) {
    const empty = { contentDelta: '', reasoningDelta: '', done: false, finishReason: null, error: null };
    try {
        switch (provider.toLowerCase()) {
            case 'openai':
            case 'openrouter':
            case 'local': {
                if (obj?.error) return { ...empty, error: providerErrorMessage(obj.error) };
                const choice = obj.choices && obj.choices[0];
                if (!choice) return empty;
                const delta = choice.delta || {};
                return {
                    contentDelta: typeof delta.content === 'string' ? delta.content : '',
                    reasoningDelta: delta.reasoning_content || delta.reasoning || '',
                    done: choice.finish_reason != null,
                    finishReason: choice.finish_reason ?? null,
                    error: null
                };
            }
            case 'anthropic': {
                if (obj.type === 'error') return { ...empty, error: providerErrorMessage(obj.error) };
                if (obj.type === 'content_block_delta') {
                    const d = obj.delta || {};
                    return {
                        ...empty,
                        contentDelta: d.type === 'text_delta' ? (d.text || '') : '',
                        reasoningDelta: d.type === 'thinking_delta' ? (d.thinking || '') : ''
                    };
                }
                if (obj.type === 'message_delta') return { ...empty, finishReason: obj.delta?.stop_reason ?? null };
                if (obj.type === 'message_stop') return { ...empty, done: true };
                return empty;
            }
            case 'google ai':
            case 'vertex ai': {
                if (obj?.error) return { ...empty, error: providerErrorMessage(obj.error) };
                const cand = obj.candidates && obj.candidates[0];
                if (!cand) {
                    const blockReason = obj?.promptFeedback?.blockReason;
                    return blockReason ? { ...empty, error: `The provider blocked this prompt (${blockReason}).` } : empty;
                }
                const parts = cand.content?.parts;
                return {
                    contentDelta: textOfParts(parts, false),
                    reasoningDelta: textOfParts(parts, true),
                    done: cand.finishReason != null,
                    finishReason: cand.finishReason ?? null,
                    error: null
                };
            }
            default:
                return empty;
        }
    } catch (error) {
        console.error("Failed to parse stream chunk:", error, obj);
        return empty;
    }
}

// --- CORE API REQUESTS ---

async function buildRequest({ apiProfileId, model, systemPrompt = '', chatHistory = [], newPrompt = '', temperature, maxTokens, maxPayloadTokens, payloadBreakdown = null, manualMode, manualJson, attachedImages, stream = false, jsonMode = false, jsonSchema = null }, dependencies = {}) {
    const db = dependencies.database || getDatabase();
    const resolveVariables = createPromptVariableResolver(db);
    systemPrompt = resolveVariables(systemPrompt);
    newPrompt = resolveVariables(newPrompt);

    const apiProfile = db.prepare('SELECT * FROM api_profiles WHERE id = ?').get(apiProfileId);
    if (!apiProfile) {
        throw new Error(`API Profile not found: ${apiProfileId}`);
    }

    const provider = apiProfile.provider.toLowerCase();
    const apiKey = db.decryptApiKey(apiProfile.apiKey);
    const baseUrl = apiProfile.baseUrl;

    let customConfig = {};
    if (apiProfile.customConfig) {
        try {
            const decryptedConfig = db.decryptApiKey(apiProfile.customConfig);
            customConfig = JSON.parse(decryptedConfig);
        } catch (e) {
            console.error("Failed to parse customConfig in sendApiRequest:", e);
        }
    }

    let requestHeaders = {};
    let requestBody = {};
    let endpoint = "";

    const cleanHistory = chatHistory.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : msg.role,
        content: msg.content
    }));
    const outputTokens = providerOutputLimit(provider, model, maxTokens);
    const payloadLimit = payloadLimitFor(apiProfile, maxPayloadTokens);
    assertPayloadWithinLimit({
        maxPayloadTokens: payloadLimit.limit,
        limitSource: payloadLimit.source,
        breakdown: payloadBreakdown,
        systemPrompt,
        chatHistory: cleanHistory,
        newPrompt,
        attachedImageCount: attachedImages?.length || 0,
        outputTokens: requestedOutputTokens(maxTokens)
    });

    switch (provider) {
        case 'openai':
        case 'openrouter':
        case 'local': {
            endpoint = resolveOpenAiCompatibleEndpoint(baseUrl, provider, 'chat');
            requestHeaders = buildOpenAiCompatibleHeaders(apiKey);
            if (provider === 'openrouter') {
                requestHeaders["HTTP-Referer"] = "https://github.com/Kallamo/Kallamo";
                requestHeaders["X-Title"] = "Kallamo";
            }

            let userContent = newPrompt;
            if (attachedImages && attachedImages.length > 0) {
                const isVisionModel = provider === 'openai' || provider === 'openrouter' ||
                    (provider === 'local' && (model.toLowerCase().includes('vision') || model.toLowerCase().includes('llava') || model.toLowerCase().includes('vl')));

                if (isVisionModel) {
                    userContent = [{ type: "text", text: newPrompt }];
                    for (const img of attachedImages) {
                        try {
                            const mimeType = getMimeType(img.path);
                            const base64Data = fs.readFileSync(img.path).toString("base64");
                            userContent.push({
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Data}`
                                }
                            });
                        } catch (err) {
                            console.error(`Failed to read/encode image ${img.name}:`, err);
                        }
                    }
                } else {
                    const imageNames = attachedImages.map(img => img.name).join(', ');
                    userContent = `${newPrompt}\n\n[Attached Image(s): ${imageNames}]`;
                }
            }

            requestBody = {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...cleanHistory,
                    { role: "user", content: userContent }
                ],
                stream: false
            };
            // Reasoning models accept only their default temperature and reject the
            // request otherwise. Manual JSON can still set one explicitly.
            if (!needsMaxCompletionTokens(model)) requestBody.temperature = temperature ?? 0.7;
            if (jsonMode && provider !== 'local') requestBody.response_format = openAiResponseFormat(jsonSchema);
            if (needsMaxCompletionTokens(model)) {
                requestBody.max_completion_tokens = outputTokens;
            } else {
                requestBody.max_tokens = outputTokens;
            }
            break;
        }

        case 'anthropic': {
            endpoint = baseUrl || "https://api.anthropic.com/v1/messages";
            requestHeaders = {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            };

            let userContent = newPrompt;
            if (attachedImages && attachedImages.length > 0) {
                userContent = [{ type: "text", text: newPrompt }];
                for (const img of attachedImages) {
                    try {
                        const mimeType = getMimeType(img.path);
                        const base64Data = fs.readFileSync(img.path).toString("base64");
                        userContent.push({
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mimeType,
                                data: base64Data
                            }
                        });
                    } catch (err) {
                        console.error(`Failed to read/encode image ${img.name}:`, err);
                    }
                }
            }

            requestBody = {
                model: model,
                system: systemPrompt,
                messages: [...cleanHistory, { role: "user", content: userContent }],
                temperature: temperature ?? 0.7,
                max_tokens: outputTokens,
                stream: false
            };
            break;
        }

        case 'google ai': {
            endpoint = baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            requestHeaders = {
                "Content-Type": "application/json"
            };

            const geminiParts = [{ text: newPrompt }];
            if (attachedImages && attachedImages.length > 0) {
                for (const img of attachedImages) {
                    try {
                        const mimeType = getMimeType(img.path);
                        const base64Data = fs.readFileSync(img.path).toString("base64");
                        geminiParts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    } catch (err) {
                        console.error(`Failed to read/encode image ${img.name}:`, err);
                    }
                }
            }

            const geminiContents = cleanHistory.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            geminiContents.push({
                role: "user",
                parts: geminiParts
            });

            requestBody = {
                system_instruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: geminiContents,
                generationConfig: {
                    temperature: temperature ?? 0.7,
                    maxOutputTokens: outputTokens,
                    ...(jsonMode ? { responseMimeType: 'application/json' } : {})
                }
            };
            break;
        }

        case 'vertex ai': {
            const gcpRegion = customConfig.gcpRegion || 'us-central1';
            const gcpProjectId = customConfig.gcpProjectId;
            endpoint = `https://${gcpRegion}-aiplatform.googleapis.com/v1/projects/${gcpProjectId}/locations/${gcpRegion}/publishers/google/models/${model}:generateContent`;

            const gcpToken = await getGcpAccessToken(customConfig.gcpServiceAccount);
            requestHeaders = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${gcpToken}`
            };

            const vertexParts = [{ text: newPrompt }];
            if (attachedImages && attachedImages.length > 0) {
                for (const img of attachedImages) {
                    try {
                        const mimeType = getMimeType(img.path);
                        const base64Data = fs.readFileSync(img.path).toString("base64");
                        vertexParts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    } catch (err) {
                        console.error(`Failed to read/encode image ${img.name}:`, err);
                    }
                }
            }

            const vertexContents = cleanHistory.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            vertexContents.push({
                role: "user",
                parts: vertexParts
            });

            requestBody = {
                system_instruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: vertexContents,
                generationConfig: {
                    temperature: temperature ?? 0.7,
                    maxOutputTokens: outputTokens,
                    ...(jsonMode ? { responseMimeType: 'application/json' } : {})
                }
            };
            break;
        }

        case 'aws bedrock': {
            const awsRegion = customConfig.awsRegion || 'us-east-1';
            // AWS encodes the received path once, so the canonical URI is encoded once and the URL stays raw.
            // Encoding both breaks the signature.
            endpoint = `https://bedrock-runtime.${awsRegion}.amazonaws.com/model/${model}/invoke`;
            requestHeaders = {
                "Content-Type": "application/json",
                "host": `bedrock-runtime.${awsRegion}.amazonaws.com`
            };

            if (model.toLowerCase().includes("claude")) {
                let bedrockMessages = [...cleanHistory];
                let userContent = newPrompt;
                if (attachedImages && attachedImages.length > 0) {
                    userContent = [{ type: "text", text: newPrompt }];
                    for (const img of attachedImages) {
                        try {
                            const mimeType = getMimeType(img.path);
                            const base64Data = fs.readFileSync(img.path).toString("base64");
                            userContent.push({
                                type: "image",
                                source: {
                                    type: "base64",
                                    media_type: mimeType,
                                    data: base64Data
                                }
                            });
                        } catch (err) {
                            console.error(`Failed to read/encode image ${img.name}:`, err);
                        }
                    }
                }
                bedrockMessages.push({ role: "user", content: userContent });

                requestBody = {
                    anthropic_version: "bedrock-2023-05-31",
                    max_tokens: outputTokens,
                    system: systemPrompt,
                    messages: bedrockMessages,
                    temperature: temperature ?? 0.7
                };
                requestBody = applyBedrockStructuredOutput(requestBody, jsonSchema);
            } else if (model.toLowerCase().includes("meta") || model.toLowerCase().includes("llama")) {
                let bedrockPrompt = newPrompt;
                if (attachedImages && attachedImages.length > 0) {
                    const imageNames = attachedImages.map(img => img.name).join(', ');
                    bedrockPrompt = `${newPrompt}\n\n[Attached Image(s): ${imageNames}]`;
                }

                let compiledPrompt = "";
                if (systemPrompt) {
                    compiledPrompt += `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>\n`;
                } else {
                    compiledPrompt += `<|begin_of_text|>`;
                }
                for (const msg of cleanHistory) {
                    const roleName = msg.role === 'assistant' ? 'assistant' : 'user';
                    compiledPrompt += `<|start_header_id|>${roleName}<|end_header_id|>\n\n${msg.content}<|eot_id|>\n`;
                }
                compiledPrompt += `<|start_header_id|>user<|end_header_id|>\n\n${bedrockPrompt}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n\n`;

                requestBody = {
                    prompt: compiledPrompt,
                    max_gen_len: outputTokens,
                    temperature: temperature ?? 0.7
                };
            } else {
                let bedrockPrompt = newPrompt;
                if (attachedImages && attachedImages.length > 0) {
                    const imageNames = attachedImages.map(img => img.name).join(', ');
                    bedrockPrompt = `${newPrompt}\n\n[Attached Image(s): ${imageNames}]`;
                }

                requestBody = {
                    prompt: bedrockPrompt,
                    max_tokens: outputTokens,
                    temperature: temperature ?? 0.7
                };
            }
            break;
        }

        default:
            throw new Error(`The provider '${provider}' is not supported yet.`);
    }

    // Bedrock has no text SSE; streaming falls back before reaching here.
    if (stream) {
        if (provider === 'google ai' || provider === 'vertex ai') {
            endpoint = endpoint.replace(':generateContent', ':streamGenerateContent');
            endpoint += endpoint.includes('?') ? '&alt=sse' : '?alt=sse';
        } else if (provider !== 'aws bedrock') {
            requestBody.stream = true;
        }
    }

    if (manualMode && manualJson) {
        try {
            const manualParams = JSON.parse(manualJson);
            requestBody = { ...requestBody, ...manualParams };
            // A null value in the Manual JSON deletes the key, so users can drop
            // a param entirely (e.g. remove max_tokens for gpt-5 style models).
            for (const key of Object.keys(manualParams)) {
                if (manualParams[key] === null) delete requestBody[key];
            }
            console.log("Manual JSON payload injected successfully.");
        } catch (err) {
            console.error("Failed to parse Manual JSON payload. Falling back to default parameters.", err);
        }
    }

    let requestBodyPayload = JSON.stringify(requestBody);

    if (provider === 'aws bedrock') {
        const awsRegion = customConfig.awsRegion || 'us-east-1';
        awsSignV4({
            accessKeyId: customConfig.awsAccessKeyId,
            secretAccessKey: customConfig.awsSecretAccessKey,
            region: awsRegion,
            service: "bedrock",
            method: "POST",
            path: `/model/${encodeURIComponent(model)}/invoke`,
            headers: requestHeaders,
            body: requestBodyPayload
        });
    }

    return { endpoint, requestHeaders, requestBodyPayload, provider };
}

async function sendApiRequest(params) {
    const { endpoint, requestHeaders, requestBodyPayload, provider } = await buildRequest(params);
    const { abortSignal } = params;

    try {
        const response = await undiciFetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyPayload,
            signal: abortSignal,
            dispatcher: generationDispatcher
        });

        if (!response.ok) {
            throw new Error(await readHttpErrorMessage(response));
        }

        const data = await response.json();
        const content = parseResponse(data, provider, Boolean(params.jsonMode));
        if (!params.includeResponseMetadata) return content;
        return { content, ...getResponseMetadata(data, provider) };

    } catch (error) {
        console.error("API Request Failed:", error);
        throw error;
    }
}

// --- EMBEDDINGS ---

async function getEmbeddings(text, apiProfileId, modelName) {
    const db = getDatabase();
    if (!apiProfileId) {
        throw new Error("No API Profile selected for external embeddings.");
    }

    const apiProfile = db.prepare('SELECT * FROM api_profiles WHERE id = ?').get(apiProfileId);
    if (!apiProfile) {
        throw new Error(`API Profile not found: ${apiProfileId}`);
    }

    const provider = apiProfile.provider.toLowerCase();
    const apiKey = db.decryptApiKey(apiProfile.apiKey);
    const baseUrl = apiProfile.baseUrl;

    let endpoint = "";
    let requestHeaders = {};
    let requestBody = {};

    switch (provider) {
        case 'openai':
        case 'openrouter':
        case 'local':
            endpoint = resolveOpenAiCompatibleEndpoint(baseUrl, provider, 'embeddings');
            requestHeaders = buildOpenAiCompatibleHeaders(apiKey);
            requestBody = {
                input: text,
                model: modelName || "text-embedding-3-small"
            };
            break;

        case 'google ai':
            const model = modelName || "text-embedding-004";
            endpoint = baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
            requestHeaders = {
                "Content-Type": "application/json"
            };
            requestBody = {
                content: {
                    parts: [{ text: text }]
                }
            };
            break;

        case 'anthropic':
            throw new Error("Anthropic does not offer a native embeddings API. Please use OpenAI, Google AI, or another provider for embeddings.");

        default:
            throw new Error(`The provider '${provider}' is not supported for vector embeddings.`);
    }

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(await readHttpErrorMessage(response));
        }

        const data = await response.json();

        if (provider === 'google ai') {
            if (data.embedding && data.embedding.values) {
                return data.embedding.values;
            }
            throw new Error("Invalid Gemini embedding response format");
        } else {
            if (data.data && data.data[0] && data.data[0].embedding) {
                return data.data[0].embedding;
            }
            throw new Error("Invalid OpenAI embedding response format");
        }
    } catch (error) {
        console.error("External Embedding API Request Failed:", error);
        throw error;
    }
}

module.exports = {
    sendApiRequest,
    getEmbeddings,
    buildRequest,
    parseResponse,
    parseStreamChunk,
    providerOutputLimit,
    requestedOutputTokens,
    getReservedOutputTokens,
    resolvePayloadLimit,
    createPromptVariableResolver,
    needsMaxCompletionTokens,
    isGeminiThinkingModel,
    REASONING_OUTPUT_HEADROOM,
    generationDispatcher,
    buildOpenAiCompatibleHeaders,
    readHttpErrorMessage,
    resolveEndpoint,
    resolveOpenAiCompatibleEndpoint
};
