import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // SSE streams: don't intercept already-started responses
    if (res.headersSent) return;

    const anyExc = exception as any;
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : (typeof anyExc?.status === 'number' ? anyExc.status
        : (typeof anyExc?.statusCode === 'number' ? anyExc.statusCode
          : HttpStatus.INTERNAL_SERVER_ERROR));

    const message = exception instanceof HttpException
      ? (exception.getResponse() as any)?.message || exception.message
      : (anyExc?.message || 'Internal server error');

    const uid = (req as any).user?.id ?? (req as any).user?.sub ?? 'anon';
    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} [uid=${uid}] → ${status}: ${String(exception instanceof Error ? exception.stack : exception)}`);
    } else if (status >= 400) {
      this.logger.warn(`${req.method} ${req.url} [uid=${uid}] → ${status}: ${message}`);
    }

    res.status(status).json({ statusCode: status, message, path: req.url });
  }
}
