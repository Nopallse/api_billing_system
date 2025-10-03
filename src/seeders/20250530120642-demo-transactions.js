'use strict';
const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Dapatkan device ID yang sudah ada
    const devices = await queryInterface.sequelize.query(
      'SELECT id, name from Devices;',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    return queryInterface.bulkInsert('Transactions', [{
      id: uuidv4(),
      deviceId: devices[0].id,
      start: oneHourAgo,
      end: now,
      duration: 60, // 60 menit
      cost: 10000, // Rp 10.000 untuk 1 jam PS4 Standard
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down (queryInterface, Sequelize) {
    return queryInterface.bulkDelete('Transactions', null, {});
  }
};