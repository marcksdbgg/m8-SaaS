import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Module({
    imports: [
        LoggerModule.forRoot({
            pinoHttp: {
                transport: {
                    target: 'pino-pretty',
                    options: {
                        singleLine: true,
                    },
                },
            },
        }),
    ],
    controllers: [],
    providers: [],
})
export class AppModule { }
