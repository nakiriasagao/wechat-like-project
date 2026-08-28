import { BizCode, httpStatusFor } from "./error.js";

/** 统一的业务异常：携带业务码，中间件转成 JSON 响应 */
export class AppError extends Error {
  readonly code: number;
  readonly status: number;
  readonly detail?: unknown;

  constructor(code: number, message?: string, detail?: unknown) {
    super(message ?? `业务错误 ${code}`);
    this.code = code;
    this.status = httpStatusFor(code);
    this.detail = detail;
  }

  static forbidden(code: number = BizCode.FORBIDDEN, msg = "无权限", detail?: unknown) {
    return new AppError(code, msg, detail);
  }
  static notFound(code: number = BizCode.NOT_FOUND, msg = "资源不存在") {
    return new AppError(code, msg);
  }
  static bad(code: number = BizCode.VALIDATION_ERROR, msg = "参数校验失败", detail?: unknown) {
    return new AppError(code, msg, detail);
  }
  static conflict(code: number = BizCode.STATE_CONFLICT, msg = "状态冲突不可执行") {
    return new AppError(code, msg);
  }
  static unauthorized(code: number = BizCode.UNAUTHENTICATED, msg = "未认证") {
    return new AppError(code, msg);
  }
}
