import type { MetaFunction } from "@remix-run/node";
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

import { CssVarsProvider, extendTheme } from "@mui/joy/styles";
import colors from "@mui/joy/colors";
import Sheet from "@mui/joy/Sheet";
import HelloWorld from "~/lib/components/HelloWorld";

import styles from "~/styles.css";

const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: colors.blue,
        // secondary: colors.red,
      },
    },
  },
});

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "New Remix App",
  viewport: "width=device-width,initial-scale=1",
});

export function links() {
  return [
    {
      rel: "stylesheet",
      href: styles,
    },
  ];
}

export default function App() {
  return (
    <CssVarsProvider theme={theme}>
      <html lang="en">
        <head>
          <Meta />
          <Links />
        </head>
        <body>
          <Sheet sx={{ p: 1, background: "transparent" }}>
            <Outlet />
            <HelloWorld />
          </Sheet>
          <ScrollRestoration />
          <Scripts />
          <LiveReload />
        </body>
      </html>
    </CssVarsProvider>
  );
}
