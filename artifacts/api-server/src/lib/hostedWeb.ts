import express, { type Express } from "express";
import { statSync } from "node:fs";
import path from "node:path";

/** Serve the Expo web export alongside the existing API on one HTTPS origin. */
export function attachHostedWeb(app: Express, webDirectory?: string): void {
  if (!webDirectory) return;
  const directory = path.resolve(webDirectory);
  const index = path.join(directory, "index.html");
  if (!statSync(index).isFile()) {
    throw new Error("ROUNDHOUSE_WEB_DIR must contain the built web app's index.html.");
  }

  // API handlers were mounted first. Unknown API endpoints must never return
  // the frontend's HTML, including when the client sends a POST request.
  app.use((req, res, next) => {
    if (/^\/api(?:\/|$)/.test(req.path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.path.split("/").some((segment) => segment.startsWith("."))) {
      res.sendStatus(404);
      return;
    }
    next();
  });
  app.use(express.static(directory, { index: false, dotfiles: "deny", maxAge: 0 }));
  app.get("/{*page}", (req, res, next) => {
    if (/^\/(?:_expo|assets)(?:\/|$)/.test(req.path) || path.extname(req.path)) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index, (error) => {
      if (error) next(error);
    });
  });
}
