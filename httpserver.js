import { serve, serveTLS } from "https://deno.land/std@0.78.0/http/server.ts";
import { acceptWebSocket } from "https://deno.land/std@0.78.0/ws/mod.ts";
import { BufReader } from "https://deno.land/std@0.78.0/io/bufio.ts";

var httpserver = {};

httpserver.cors = '*';

httpserver.before = (r)=>null;
httpserver.after = (r)=>null;

httpserver.handler = {};
httpserver.path = (path, f) => httpserver.handler[path] = f

httpserver.wshandler = {};
httpserver.ws = (path, f) => httpserver.wshandler[path] = f

httpserver.ok = (data) => { return {error: null, data} };
httpserver.err = (error) => { return {error, data: null} };
httpserver.notfound = (r)=>httpserver.err('404')

function response(o){this.o={status: o.status, headers: new Headers(o.headers), body: o.body};}
httpserver.response = (o)=> new response(o)

var debug = false;
Object.defineProperty(httpserver, 'debug', {
    get: function(){
        return debug;
    },
    set: function(v){
        debug = v;
    },
});
var log = (...args) => debug && console.log((new Date()).toString(), ...args)

var handle = async (r) => {
    httpserver.before(r);
    log("=>", r.url);

    r.query = {};
    r.json = null;
    r.uint8Array = null;
    r.response = null;

    var i = r.url.indexOf('?');
    if(i != -1){
        r.url.substr(i+1).split('&').forEach(v => {if(v.split('=')[0]) r.query[v.split('=')[0]] = v.split('=')[1] ? decodeURIComponent(v.split('=')[1]) : '';});
    }
    log(r.url, "query", r.query);

    var headers = {"Content-Type": "application/json"};
    if(r.headers.get("Origin")){
        headers["Access-Control-Allow-Origin"] = httpserver.cors;
        headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, HEAD, PATCH";
        if(r.headers.get("Access-Control-Request-Headers")){
            headers["Access-Control-Allow-Headers"] = r.headers.get("Access-Control-Request-Headers");
        }
        headers["Access-Control-Max-Age"] = 24*60*60;
    }

    var h = httpserver.handler[r.url.split('?')[0]];
    if(!h){
        var wsh = httpserver.wshandler[r.url.split('?')[0]];
        if(!wsh){
            try{
                var o = await httpserver.notfound(r);
                r.respond(o instanceof response ? o.o : {headers: new Headers(headers), body: JSON.stringify(o)});
            }catch(e){
                var o = httpserver.err(e.toString());
                r.respond(o instanceof response ? o.o : {headers: new Headers(headers), body: JSON.stringify(o)});
            }
            r.response = o;
            log('<=', r.url, o);
            httpserver.after(r);
            return;
        }
        try {
            var ws = await acceptWebSocket({
                conn: r.conn,
                bufReader: r.r,
                bufWriter: r.w,
                headers: r.headers,
            });
        } catch (e) {
            var o = httpserver.err(e.toString());
            r.respond(o instanceof response ? o.o : {headers: new Headers(headers), body: JSON.stringify(o)});
            r.response = o;
            log('<=', r.url, o);
            httpserver.after(r);
            return;
        }
        wsh(r, ws).catch(async e=>{
            console.error("wshandle", r.url, e);
            if (!ws.isClosed) {
                await ws.close(1000).catch(console.error);
            }
            httpserver.after(r);
        });
        return;
    }

    if(r.contentLength !== null){
        var b = new Uint8Array(r.contentLength);
        var br = await new BufReader(r.body);
        var b1 = await br.readFull(b);
        if (b1 === null){
            log(r.url, "body length is", r.contentLength, "but read 0, ignored")
            return;
        }
        r.uint8Array = b;
        try{
            r.json = JSON.parse(new TextDecoder().decode(b));
        }catch(e){
            log(r.url, "body is not json, you can read it from r.unit8Array");
        }
    }
    if(r.json){
        log(r.url, "body", r.json);
    }

    try{
        var o = await h(r);
        r.respond(o instanceof response ? o.o : {headers: new Headers(headers), body: JSON.stringify(o)});
    }catch(e){
        var o = httpserver.err(e.toString());
        r.respond(o instanceof response ? o.o : {headers: new Headers(headers), body: JSON.stringify(o)});
    }
    r.response = o;
    log('<=', r.url, o);
    httpserver.after(r);
}

httpserver.run = async (options) => {
    if(!options || typeof options === 'number'){
        var s = serve({
            port: options || 2020,
        });
    }else{
        var s = serveTLS({
            port: options.port || 2020,
            hostname: options.hostname,
            certFile: options.certFile,
            keyFile: options.keyFile,
        });
    }
    for await (var r of s) {
        handle(r).catch(console.error);
    }
}

export default httpserver;
