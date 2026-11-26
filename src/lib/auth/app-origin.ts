export function appOrigin(request: Request) {
  // The configured origin binds credentials and must not depend on Host in production.
  return (
    process.env.APP_ORIGIN?.trim().replace(/\/$/, "") ||
    (process.env.NODE_ENV !== "production" ? new URL(request.url).origin : "")
  );
}
