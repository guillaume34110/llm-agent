import { Module } from '@nestjs/common';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ModerationModule } from './moderation/moderation.module';
import { InquirySettingsModule } from './settings/inquiry-settings.module';
import { InquiryModule } from './inquiry/inquiry.module';
import { MatchModule } from './match/match.module';
import { FriendshipModule } from './friendship/friendship.module';
import { GroupModule } from './group/group.module';
import { WallModule } from './wall/wall.module';
import { ClusterModule } from './cluster/cluster.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    PrismaModule,
    ModerationModule,
    InquirySettingsModule,
    InquiryModule,
    MatchModule,
    FriendshipModule,
    GroupModule,
    WallModule,
    ClusterModule,
    ProjectsModule,
  ],
  providers: [SocialService],
  controllers: [SocialController],
  exports: [SocialService],
})
export class SocialModule {}
