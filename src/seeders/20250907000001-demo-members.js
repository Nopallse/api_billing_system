'use strict';
const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const hashedPin = await bcrypt.hash('1234', 10);
    const hashedPin2 = await bcrypt.hash('5678', 10);
    const hashedPin3 = await bcrypt.hash('9999', 10);
    
    await queryInterface.bulkInsert('Members', [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'john.doe@example.com',
        username: 'johndoe',
        pin: hashedPin,
        deposit: 100000.00,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        email: 'jane.smith@example.com',
        username: 'janesmith',
        pin: hashedPin2,
        deposit: 50000.00,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440003',
        email: 'bob.wilson@example.com',
        username: 'bobwilson',
        pin: hashedPin3,
        deposit: 25000.00,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Members', null, {});
  }
};
