'use strict';
const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    return queryInterface.bulkInsert('Categories', [{
      id: uuidv4(),
      categoryName: 'PS4 Standard - 1 Jam',
      cost: 10000, // Rp 10.000 per jam
      periode: 60,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: uuidv4(),
      categoryName: 'PS5 Standard - 1 Jam',
      cost: 15000, // Rp 15.000 per jam
      periode: 60,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down (queryInterface, Sequelize) {
    return queryInterface.bulkDelete('Categories', null, {});
  }
};