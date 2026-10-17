/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers(){
    const headers=[
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Content-Security-Policy",value:"frame-ancestors 'none'; base-uri 'self'"},
      {key:"Referrer-Policy",value:"no-referrer"},
      {key:"X-Content-Type-Options",value:"nosniff"}
    ];
    return [
      {source:"/oauth/:path*",headers},
      // Native POST forms under no-referrer send Origin: null, which our
      // CSRF guard must reject. Preserve same-origin form provenance while
      // still suppressing consent URLs in cross-origin referrers.
      {source:"/oauth/authorize",headers:[{key:"Referrer-Policy",value:"same-origin"}]},
      {source:"/login",headers}
    ];
  }
};
export default nextConfig;
