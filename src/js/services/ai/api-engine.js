// --- API REQUEST ENGINE (ADAPTER) ---

async function sendApiRequest(apiProfile, systemPrompt, chatHistory, newPrompt) {
    const provider = apiProfile.provider.toLowerCase();
    const apiKey = apiProfile.apiKey;
    const baseUrl = apiProfile.baseUrl;
    
    let requestHeaders = {};
    let requestBody = {};
    let endpoint = "";

    switch (provider) {
        case 'openai':
        case 'openrouter':
        case 'local':
            endpoint = baseUrl || "https://api.openai.com/v1/chat/completions";
            requestHeaders = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            };
            
            const openAiMessages = [
                { role: "system", content: systemPrompt },
                ...chatHistory,
                { role: "user", content: newPrompt }
            ];

            requestBody = {
                model: apiProfile.model,
                messages: openAiMessages,
                temperature: apiProfile.temperature,
                max_tokens: apiProfile.maxTokens,
                stream: false 
            };
            break;

        case 'anthropic':
            endpoint = baseUrl || "https://api.anthropic.com/v1/messages";
            requestHeaders = {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01" 
            };
            
            requestBody = {
                model: apiProfile.model,
                system: systemPrompt, 
                messages: [...chatHistory, { role: "user", content: newPrompt }],
                temperature: apiProfile.temperature,
                max_tokens: apiProfile.maxTokens,
                stream: false
            };
            break;

        case 'google ai':
            endpoint = baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${apiProfile.model}:generateContent?key=${apiKey}`;
            requestHeaders = {
                "Content-Type": "application/json"
            };
            
            const geminiContents = chatHistory.map(msg => ({
                role: msg.role === 'ai' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            geminiContents.push({
                role: "user",
                parts: [{ text: newPrompt }]
            });

            requestBody = {
                system_instruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: geminiContents,
                generationConfig: {
                    temperature: apiProfile.temperature,
                    maxOutputTokens: apiProfile.maxTokens
                }
            };
            break;

        default:
            throw new Error(`The provider '${provider}' is not supported yet.`);
    }

    if (apiProfile.manualMode && apiProfile.manualJson) {
        try {
            const manualParams = JSON.parse(apiProfile.manualJson);
            requestBody = { ...requestBody, ...manualParams };
            console.log("Manual JSON payload injected successfully.");
        } catch (err) {
            console.error("Failed to parse Manual JSON payload. Falling back to default parameters.", err);
        }
    }

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || response.statusText);
        }

        const data = await response.json();
        return parseResponse(data, provider);

    } catch (error) {
        console.error("API Request Failed:", error);
        return `[Connection Error]: ${error.message}`;
    }
}

// --- HELPER: RESPONSE PARSER ---
function parseResponse(data, provider) {
    try {
        switch (provider) {
            case 'openai':
            case 'openrouter':
            case 'local':
                return data.choices[0].message.content;
            case 'anthropic':
                return data.content[0].text;
            case 'google ai':
                return data.candidates[0].content.parts[0].text;
            default:
                return "Could not parse response for this provider.";
        }
    } catch (error) {
        console.error("Failed to parse API response:", error);
        return "[Error]: Received an unexpected response format from the API.";
    }
}

module.exports = { sendApiRequest };