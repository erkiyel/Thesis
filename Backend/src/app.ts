import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const configuredOrigins = (process.env.ONCOPHIL_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const allowedOrigins = new Set([
  "https://thesis-2lz262yk5-erkiyels-projects.vercel.app",
  "https://thesis-three-nu.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  ...configuredOrigins,
]);

app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = origin?.replace(/\/$/, "");
    const isVercelPreview = normalizedOrigin
      ? /^https:\/\/thesis-[a-z0-9-]+-erkiyels-projects\.vercel\.app$/i.test(normalizedOrigin)
      : false;
    callback(null, !origin || allowedOrigins.has(normalizedOrigin ?? "") || isVercelPreview);
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Accept", "Authorization", "Content-Type"],
  credentials: false,
  optionsSuccessStatus: 204,
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 100 }));

app.use("/api", router);

export default app;
