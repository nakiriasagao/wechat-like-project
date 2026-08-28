import type { NextFunction, Request, Response } from "express";
import { AppError, BizCode } from "shared";

/** 404 兜底 */
export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(BizCode.NOT_FOUND, `路由不存在: ${req.method} ${req.path}`));
}

/** 统一错误处理：AppError -> 业务码 + HTTP 状态 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      code: err.code,
      message: err.message,
      detail: err.detail,
    });
  }
  // SQLite UNIQUE 约束等
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[unhandled]", msg);
  return res.status(500).json({ code: 50000, message: "服务器内部错误" });
}
