import { Controller, Get, Delete, UseGuards, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private auth: AuthService) {}

  // GDPR Art. 15 — data export.
  @Get('export')
  async export(@Req() req: Request & { user: any }, @Res() res: Response) {
    const data = await this.auth.exportData(req.user.sub);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="progsoft-export-${Date.now()}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  // GDPR Art. 17 — account erasure (PII purged, fiscal records retained anonymised).
  @Delete()
  async erase(@Req() req: Request & { user: any }, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.deleteAccount(req.user.sub);
    res.clearCookie('token', { httpOnly: true, maxAge: 0 });
    return result;
  }
}
