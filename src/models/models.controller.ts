import { Controller, Get } from '@nestjs/common';
import { ModelsService } from './models.service';

@Controller('models')
export class ModelsController {
  constructor(private models: ModelsService) {}

  @Get()
  async list() {
    const categories = await this.models.getModelsGrouped();
    return { categories };
  }
}
