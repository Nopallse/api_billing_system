'use strict';
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    return queryInterface.bulkInsert('Users', [{
      id: uuidv4(),
      email: 'admin@example.com',
      password: await bcrypt.hash('admin123', 10),
      type: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: uuidv4(),
      email: 'user@example.com',
      password: await bcrypt.hash('user123', 10),
      type: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down (queryInterface, Sequelize) {
    return queryInterface.bulkDelete('Users', null, {});
  }
};