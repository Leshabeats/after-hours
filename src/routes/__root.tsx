import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AccountProvider } from "@/components/account-session";
import { getAuthSnapshot } from "@/lib/journal/api";
import appCss from "../styles.css?url";

const APP_NAME = "After Hours";
const APP_DESCRIPTION =
  "Жги токены. Чини опенсорс. After Hours выбирает баг, ревью или ишью из стека, которым ты пользуешься.";

export const Route = createRootRoute({
  loader: () => getAuthSnapshot(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: APP_DESCRIPTION },
      { name: "theme-color", content: "#0a0606" },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: APP_DESCRIPTION },
      { property: "og:image", content: "/og.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Outfit:wght@300;400;500;600&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const snapshot = Route.useLoaderData();
  return (
    <html lang="ru" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <AccountProvider initial={snapshot}>
          <Outlet />
        </AccountProvider>
        <Toaster
          theme="dark"
          position="bottom-center"
          toastOptions={{
            className: "bg-elevated text-fg border-border font-sans text-sm",
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}
