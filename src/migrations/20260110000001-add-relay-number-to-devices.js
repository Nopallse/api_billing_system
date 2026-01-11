'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Devices', 'relayNumber', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Relay number for ESP32 BLE control (1-4)'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Devices', 'relayNumber');
  }
};
