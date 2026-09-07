import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

/**
 * Custom HTML shell for the Expo web build. We force aggressive no-cache
 * headers in development so Safari (which loves to hold on to stale bundles)
 * always shows the latest code on every load.
 *
 * NOTE: This file is only honored when the app uses static rendering
 * (`web.output: "static"`). Roundhouse currently uses single-page web
 * rendering, so the production HTML shell is the default Expo template
 * — and our Progressive Web App meta tags (manifest, apple-touch-icon,
 * theme-color, etc.) are injected at the end of the build by
 * `scripts/build.js → injectPwaMetaTags()`. Keep both call sites in
 * sync if you change one.
 */
export default function Root({ children }: PropsWithChildren) {
  const isDev = process.env.NODE_ENV !== "production";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {isDev ? (
          <>
            <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0" />
            <meta httpEquiv="Pragma" content="no-cache" />
            <meta httpEquiv="Expires" content="0" />
          </>
        ) : null}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
