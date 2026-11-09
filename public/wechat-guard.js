(function () {
    var ua = navigator.userAgent || '';
    if (ua.indexOf('MicroMessenger') === -1) return;
    if (location.pathname === '/wechat-guide.html') return;

    var next = location.pathname + location.search + location.hash;
    if (next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/';
    location.replace('/wechat-guide.html?next=' + encodeURIComponent(next));
})();
