const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Halqa Management System API',
      version: '1.0.0',
      description: 'Enterprise School ERP / Student Information System API',
      contact: {
        name: 'Halqa Support',
        email: 'support@halqa.com'
      }
    },
    servers: [
      { url: 'http://localhost:5000/api/v1', description: 'Development' },
      { url: 'https://api.halqa.com/api/v1', description: 'Production' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js']
};

const specs = swaggerJsdoc(options);

function swaggerSetup(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    customCss: '.swagger-ui .topbar { background-color: #1e40af; }',
    customSiteTitle: 'Halqa API Docs'
  }));
  app.get('/api-docs.json', (req, res) => res.json(specs));
}

module.exports = swaggerSetup;
