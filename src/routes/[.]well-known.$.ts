import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request }: { request: Request }) => {
  const { handleMcpRoute } = await import("@/lib/mcp/runtime");
  return handleMcpRoute(request);
};
export const Route = createFileRoute("/.well-known/$")({
  server: { handlers: { GET: handle, OPTIONS: handle } },
});
