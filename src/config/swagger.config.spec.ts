import { paymentsServiceDetails } from '@/utils/payments-service-details';
import { buildSwaggerConfig } from './swagger.config';

describe('buildSwaggerConfig', () => {
  it('identifies the service in the document metadata', () => {
    const config = buildSwaggerConfig();

    expect(config.info).toMatchObject({
      title: 'Marketplace Payments Service',
      version: paymentsServiceDetails.version,
      contact: {
        name: 'Marketplace Team',
        url: 'https://marketplace.com',
        email: 'dev@marketplace.com',
      },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    });
  });

  it('writes the description flush left so Swagger renders it as prose', () => {
    const { description } = buildSwaggerConfig().info;

    // An indented line renders as a markdown code block instead of text.
    expect(description).not.toMatch(/^[ \t]+\S/m);
    expect(description).toContain('Payment processing');
  });

  it('declares the bearer scheme the guards expect', () => {
    const config = buildSwaggerConfig();

    expect(config.components?.securitySchemes?.['JWT-auth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      in: 'header',
    });
  });

  it('tags the areas this service owns', () => {
    const tags = buildSwaggerConfig().tags?.map((tag) => tag.name);

    expect(tags).toEqual(['Payments', 'Dead Letter Queue', 'Health']);
  });

  it('describes every tag, so the sidebar is not a bare list', () => {
    const tags = buildSwaggerConfig().tags ?? [];

    expect(tags).not.toHaveLength(0);
    for (const tag of tags) {
      expect(tag.description).toBeTruthy();
    }
  });
});
