import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: the exact bytes of each request stay available next to the parsed body,
  // for verifying the signature on WhatsApp webhook deliveries.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // So that module destroy hooks run on SIGTERM / SIGINT (the deletion purge worker
  // finishes its current record and stops, instead of being cut off).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
