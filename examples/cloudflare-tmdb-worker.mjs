const API_ORIGIN = 'https://api.themoviedb.org';
const IMAGE_ORIGIN = 'https://image.tmdb.org';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type'
    };
}

function textResponse(body, status) {
    return new Response(body, {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, corsHeaders())
    });
}

export default {
    async fetch(request) {
        const incoming = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }
        if (incoming.pathname === '/' || incoming.pathname === '/health') {
            return new Response(JSON.stringify({ ok: true, service: 'donggua-tmdb-proxy' }), {
                headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders())
            });
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return textResponse('Method Not Allowed', 405);
        }

        let origin = '';
        if (incoming.pathname.startsWith('/3/')) origin = API_ORIGIN;
        else if (incoming.pathname.startsWith('/t/p/')) origin = IMAGE_ORIGIN;
        else return textResponse('Not Found', 404);

        const headers = new Headers();
        const passHeaders = ['accept', 'accept-language', 'authorization', 'content-type', 'if-modified-since', 'if-none-match', 'range'];
        for (const name of passHeaders) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        headers.set('user-agent', 'DongguaTV-TMDB-Proxy/1.0');

        const target = origin + incoming.pathname + incoming.search;
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            redirect: 'follow',
            cf: {
                cacheEverything: true,
                cacheTtl: incoming.pathname.startsWith('/t/p/') ? 604800 : 300
            }
        });

        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete('set-cookie');
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
        responseHeaders.set('X-Donggua-TMDB-Proxy', '1');

        return new Response(request.method === 'HEAD' ? null : upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders
        });
    }
};
