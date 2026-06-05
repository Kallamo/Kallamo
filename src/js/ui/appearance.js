const fs = require('fs');
const path = require('path');
const { chatsDir } = require('../services/storage.js');

function applyChatAppearance(chat) {
    const bgLayer = document.getElementById('chat-bg-layer');
    const backdropLayer = document.getElementById('chat-backdrop-layer');
    const appBgOpacity = document.getElementById('appearance-bg-opacity');
    const appUserBubble = document.getElementById('appearance-user-bubble');
    const appAiBubble = document.getElementById('appearance-ai-bubble');
    
    const bgPreview = document.getElementById('bg-image-preview');
    const fileInput = document.getElementById('appearance-bg-image');
    const btnClearBg = document.getElementById('btn-clear-bg');

    // Reset to defaults if no chat is provided
    if (!chat) {
        if (bgLayer) bgLayer.style.backgroundImage = 'none';
        if (backdropLayer) {
            backdropLayer.style.backgroundColor = '#011419';
            backdropLayer.style.opacity = 1;
        }
        document.documentElement.style.setProperty('--user-bg-opacity', 1);
        document.documentElement.style.setProperty('--ai-bg-opacity', 0);
        
        if (bgPreview) bgPreview.classList.add('hidden');
        if (fileInput) fileInput.classList.remove('hidden');
        return;
    }

    const appearance = chat.appearance || {
        bgImage: chat.bgImage || "",
        opacity: chat.bgOpacity !== undefined ? chat.bgOpacity : 75,
        userOpacity: chat.userBubbleOpacity !== undefined ? chat.userBubbleOpacity : 100,
        aiOpacity: chat.aiBubbleOpacity !== undefined ? chat.aiBubbleOpacity : 0
    };

    let bgUrl = 'none';
    
    // Resolve background image path
    if (appearance.bgImage) {
        const isAbsolute = path.isAbsolute(appearance.bgImage);
        const fullPath = isAbsolute ? appearance.bgImage : path.join(chatsDir, chat.id, appearance.bgImage);
        
        if (fs.existsSync(fullPath)) {
            let safePath = fullPath.replace(/\\/g, '/');
            safePath = encodeURI(safePath).replace(/#/g, '%23');
            bgUrl = `url("file:///${safePath}")`;
        }
    }

    // Apply to Main Chat Background
    if (bgLayer) {
        bgLayer.style.backgroundImage = bgUrl;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundPosition = 'center';
        bgLayer.style.backgroundRepeat = 'no-repeat';
    }
    
    // Apply to Right Sidebar Preview Box
    if (bgPreview && fileInput) {
        if (bgUrl !== 'none') {
            bgPreview.style.backgroundImage = bgUrl;
            bgPreview.classList.remove('hidden');
            fileInput.classList.add('hidden');
        } else {
            bgPreview.style.backgroundImage = 'none';
            bgPreview.classList.add('hidden');
            fileInput.classList.remove('hidden');
        }
    }
    
    // Apply Opacities
    if (backdropLayer) {
        backdropLayer.style.backgroundColor = '#011419';
        backdropLayer.style.opacity = appearance.opacity / 100;
    }

    document.documentElement.style.setProperty('--user-bg-opacity', appearance.userOpacity / 100);
    document.documentElement.style.setProperty('--ai-bg-opacity', appearance.aiOpacity / 100);

    // Update Sidebar Sliders Visuals
    if (appBgOpacity) {
        appBgOpacity.value = appearance.opacity;
        const valLabel = document.getElementById('val-bg-opacity');
        if (valLabel) valLabel.innerText = appearance.opacity + '%';
    }
    if (appUserBubble) {
        appUserBubble.value = appearance.userOpacity;
        const valLabel = document.getElementById('val-user-opacity');
        if (valLabel) valLabel.innerText = appearance.userOpacity + '%';
    }
    if (appAiBubble) {
        appAiBubble.value = appearance.aiOpacity;
        const valLabel = document.getElementById('val-ai-opacity');
        if (valLabel) valLabel.innerText = appearance.aiOpacity + '%';
    }
}

function setupAppearanceListeners(getCurrentChatFn, saveChatDataFn, chatsDirLoc) {
    const appBgImage = document.getElementById('appearance-bg-image');
    const btnClearBg = document.getElementById('btn-clear-bg');
    const appBgOpacity = document.getElementById('appearance-bg-opacity');
    const appUserBubble = document.getElementById('appearance-user-bubble');
    const appAiBubble = document.getElementById('appearance-ai-bubble');

    function saveAppearanceProp(prop, value) {
        const currentChat = getCurrentChatFn();
        if (!currentChat) return;
        
        if (!currentChat.appearance) {
            currentChat.appearance = {
                bgImage: currentChat.bgImage || "",
                opacity: currentChat.bgOpacity !== undefined ? currentChat.bgOpacity : 75,
                userOpacity: currentChat.userBubbleOpacity !== undefined ? currentChat.userBubbleOpacity : 100,
                aiOpacity: currentChat.aiBubbleOpacity !== undefined ? currentChat.aiBubbleOpacity : 0
            };
        }
        
        currentChat.appearance[prop] = value;
        saveChatDataFn(currentChat);
        applyChatAppearance(currentChat);
    }

    if (appBgImage) {
        appBgImage.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const currentChat = getCurrentChatFn();
            if (!currentChat) {
                appBgImage.value = ''; 
                return;
            }

            try {
                const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                const targetFolder = path.join(chatsDirLoc, currentChat.id);
                if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
                
                const destBgName = `bg_image_${Date.now()}${ext}`;
                const bgDestPath = path.join(targetFolder, destBgName);
                
                if (file.path) {
                    fs.copyFileSync(file.path, bgDestPath);
                } else {
                    const arrayBuffer = await file.arrayBuffer();
                    fs.writeFileSync(bgDestPath, Buffer.from(arrayBuffer));
                }

                // Delete old image if it exists
                const oldImg = currentChat.appearance ? currentChat.appearance.bgImage : currentChat.bgImage;
                if (oldImg) {
                    const isAbsolute = path.isAbsolute(oldImg);
                    const oldPath = isAbsolute ? oldImg : path.join(chatsDirLoc, currentChat.id, oldImg);
                    if (fs.existsSync(oldPath)) {
                        try { fs.unlinkSync(oldPath); } catch(err){}
                    }
                }

                saveAppearanceProp('bgImage', destBgName);
                appBgImage.value = ''; 
            } catch (err) {
                console.error("Failed to save background image:", err);
            }
        });
    }

    if (btnClearBg) {
        btnClearBg.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentChat = getCurrentChatFn();
            if (currentChat) {
                const oldImg = currentChat.appearance ? currentChat.appearance.bgImage : currentChat.bgImage;
                if (oldImg) {
                    const isAbsolute = path.isAbsolute(oldImg);
                    const oldPath = isAbsolute ? oldImg : path.join(chatsDirLoc, currentChat.id, oldImg);
                    if (fs.existsSync(oldPath)) {
                        try { fs.unlinkSync(oldPath); } catch(err){}
                    }
                }
            }
            if (appBgImage) appBgImage.value = '';
            saveAppearanceProp('bgImage', "");
        });
    }
    
    if (appBgOpacity) appBgOpacity.addEventListener('input', (e) => saveAppearanceProp('opacity', parseInt(e.target.value)));
    if (appUserBubble) appUserBubble.addEventListener('input', (e) => saveAppearanceProp('userOpacity', parseInt(e.target.value)));
    if (appAiBubble) appAiBubble.addEventListener('input', (e) => saveAppearanceProp('aiOpacity', parseInt(e.target.value)));
}

module.exports = {
    applyChatAppearance,
    setupAppearanceListeners
};