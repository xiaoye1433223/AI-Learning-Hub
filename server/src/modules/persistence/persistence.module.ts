import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { PersistenceController } from './persistence.controller'
import { PersistenceService } from './persistence.service'
import { OperationsService } from './operations.service'
@Module({ imports: [AuthModule, StorageModule], controllers: [PersistenceController], providers: [PersistenceService, OperationsService], exports: [PersistenceService, OperationsService] })
export class PersistenceModule {}
