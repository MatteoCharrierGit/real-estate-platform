// File incorporati nel bundle da esbuild come testo (loader "text"): SQL e certificati.
declare module "*.sql" {
  const content: string;
  export default content;
}
declare module "*.pem" {
  const content: string;
  export default content;
}
