const db = require('../../database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fetch: undiciFetch, Agent } = require('undici');

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

// The gpt-5 series and reasoning models (o1/o3/o4...) reject `max_tokens` and
// require `max_completion_tokens` instead. Matched by name so future variants
// are covered without a fixed ID list.
function needsMaxCompletionTokens(model) {
    if (!model) return false;
    // Strip a provider prefix like "openai/" (OpenRouter uses vendor-slugged ids).
    const m = model.toLowerCase().split('/').pop();
    return m.startsWith('gpt-5') || /^o[1-9]($|[-.])/.test(m);
}

// A custom Base URL may be entered as a bare base (e.g. ".../v1") or as a full
// endpoint. Normalize it to the full endpoint for the given kind so both forms
// work. kind = 'chat' | 'embeddings'.
function resolveEndpoint(baseUrl, kind) {
    if (!baseUrl) return null;
    const want = kind === 'embeddings' ? '/embeddings' : '/chat/completions';
    const other = kind === 'embeddings' ? '/chat/completions' : '/embeddings';
    const trimmed = baseUrl.replace(/\/+$/, '');
    if (trimmed.endsWith(want)) return trimmed;
    if (trimmed.endsWith(other)) return trimmed.slice(0, -other.length) + want;
    return trimmed + want;
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

function parseResponse(data, provider) {
    try {
        switch (provider.toLowerCase()) {
            case 'openai':
            case 'openrouter':
            case 'local': {
                const message = data.choices[0].message;
                const reasoning = message.reasoning_content || message.reasoning;
                const content = message.content || '';
                return reasoning ? `<think>${reasoning}</think>${content}` : content;
            }
            case 'anthropic':
                return data.content[0].text;
            case 'google ai':
            case 'vertex ai':
                if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
                    return data.candidates[0].content.parts[0].text;
                }
                throw new Error("Invalid Gemini response format");
            case 'aws bedrock':
                if (data.content && data.content[0] && data.content[0].text) {
                    return data.content[0].text;
                }
                if (data.generation) {
                    return data.generation;
                }
                throw new Error("Invalid AWS Bedrock response format");
            default:
                return "Could not parse response for this provider.";
        }
    } catch (error) {
        console.error("Failed to parse API response:", error, data);
        return "[Error]: Received an unexpected response format from the API.";
    }
}

// Decode ONE already-JSON-parsed SSE event into normalized deltas. Stateless:
// the stream reader owns line-splitting, the `data:` prefix and the [DONE]
// sentinel, so this only maps a provider's chunk shape to a common
// { contentDelta, reasoningDelta, done }. The streaming mirror of parseResponse.
function parseStreamChunk(obj, provider) {
    const empty = { contentDelta: '', reasoningDelta: '', done: false };
    try {
        switch (provider.toLowerCase()) {
            case 'openai':
            case 'openrouter':
            case 'local': {
                const choice = obj.choices && obj.choices[0];
                if (!choice) return empty;
                const delta = choice.delta || {};
                return {
                    contentDelta: delta.content || '',
                    reasoningDelta: delta.reasoning_content || delta.reasoning || '',
                    done: choice.finish_reason != null
                };
            }
            case 'anthropic': {
                if (obj.type === 'content_block_delta') {
                    const d = obj.delta || {};
                    return {
                        contentDelta: d.type === 'text_delta' ? (d.text || '') : '',
                        reasoningDelta: d.type === 'thinking_delta' ? (d.thinking || '') : '',
                        done: false
                    };
                }
                if (obj.type === 'message_stop') return { ...empty, done: true };
                return empty;
            }
            case 'google ai':
            case 'vertex ai': {
                const cand = obj.candidates && obj.candidates[0];
                if (!cand || !cand.content || !cand.content.parts) return empty;
                const text = cand.content.parts.map(p => p.text || '').join('');
                return { contentDelta: text, reasoningDelta: '', done: cand.finishReason != null };
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

async function buildRequest({ apiProfileId, model, systemPrompt, chatHistory, newPrompt, temperature, maxTokens, manualMode, manualJson, attachedImages, stream = false }) {
    try {
        const variables = db.prepare('SELECT key, value FROM variables').all();
        for (const variable of variables) {
            const safeKey = variable.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\{\\{\\s*${safeKey}\\s*\\}\\}`, 'g');
            if (systemPrompt) systemPrompt = systemPrompt.replace(regex, variable.value);
            if (newPrompt) newPrompt = newPrompt.replace(regex, variable.value);
        }
    } catch (e) {
        console.error("Error resolving dynamic variables:", e);
    }

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

    switch (provider) {
        case 'openai':
        case 'openrouter':
        case 'local': {
            endpoint = resolveEndpoint(baseUrl, 'chat') || (provider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions");
            requestHeaders = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            };
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
                temperature: temperature ?? 0.7,
                stream: false
            };
            if (needsMaxCompletionTokens(model)) {
                requestBody.max_completion_tokens = maxTokens ?? 1000;
            } else {
                requestBody.max_tokens = maxTokens ?? 1000;
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
                max_tokens: maxTokens ?? 1000,
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
                    maxOutputTokens: maxTokens ?? 1000
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
                    maxOutputTokens: maxTokens ?? 1000
                }
            };
            break;
        }

        case 'aws bedrock': {
            const awsRegion = customConfig.awsRegion || 'us-east-1';
            // Send the raw model id in the URL (colon and all). AWS canonicalizes the
            // received path by URI-encoding it once, so the SigV4 canonical URI below
            // must be encoded ONCE (':' -> '%3A') while the request URL stays raw.
            // Encoding both would make AWS double-encode ('%253A') and the signature
            // would not match.
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
                    max_tokens: maxTokens ?? 1000,
                    system: systemPrompt,
                    messages: bedrockMessages,
                    temperature: temperature ?? 0.7
                };
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
                    max_gen_len: maxTokens ?? 1000,
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
                    max_tokens: maxTokens ?? 1000,
                    temperature: temperature ?? 0.7
                };
            }
            break;
        }

        default:
            throw new Error(`The provider '${provider}' is not supported yet.`);
    }

    // Streaming toggles, inert when stream is false. Bedrock has no text-SSE
    // stream, so the streaming entry point falls back to the non-streaming path
    // for it and never builds a streaming request here.
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
            let errorMsg = response.statusText;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || JSON.stringify(errorData);
            } catch (e) { }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        return parseResponse(data, provider);

    } catch (error) {
        console.error("API Request Failed:", error);
        throw error;
    }
}

// --- EMBEDDINGS ---

async function getEmbeddings(text, apiProfileId, modelName) {
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
            endpoint = resolveEndpoint(baseUrl, 'embeddings') || (provider === 'openrouter' ? "https://openrouter.ai/api/v1/embeddings" : "https://api.openai.com/v1/embeddings");
            requestHeaders = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            };
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
            let errorMsg = response.statusText;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || JSON.stringify(errorData);
            } catch (e) { }
            throw new Error(errorMsg);
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

module.exports = { sendApiRequest, getEmbeddings, buildRequest, parseStreamChunk, generationDispatcher };
