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
    return [{source:"/oauth/:path*",headers},{source:"/login",headers}];
  }
};
export default nextConfig;
