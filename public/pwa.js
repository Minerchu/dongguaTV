(function () {
    'use strict';

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () { });
        });
    }

    var deferredPrompt = null;
    var button = null;
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    var isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

    function showInstallButton() {
        if (button && !standalone) button.hidden = false;
    }

    function install() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function () {
                deferredPrompt = null;
                if (button) button.hidden = true;
            }).catch(function () { });
            return;
        }
        if (isIos) {
            window.alert('在 Safari 中点击底部分享按钮，然后选择“添加到主屏幕”。');
        }
    }

    function mount() {
        button = document.getElementById('pwa-install');
        if (!button || standalone) return;
        button.addEventListener('click', install);
        window.addEventListener('beforeinstallprompt', function (event) {
            event.preventDefault();
            deferredPrompt = event;
            showInstallButton();
        });
        window.addEventListener('appinstalled', function () {
            deferredPrompt = null;
            button.hidden = true;
        });
        if (isIos) showInstallButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
