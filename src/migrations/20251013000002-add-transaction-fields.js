'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Tambah kolom paymentType
    await queryInterface.addColumn('Transactions', 'paymentType', {
      type: Sequelize.ENUM('upfront', 'end'),
      allowNull: true,
      defaultValue: 'upfront'
    });
    
    // Tambah kolom status
    await queryInterface.addColumn('Transactions', 'status', {
      type: Sequelize.ENUM('active', 'completed', 'cancelled'),
      allowNull: true,
      defaultValue: 'active'
    });
    
    // Tambah kolom userId
    await queryInterface.addColumn('Transactions', 'userId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Transactions', 'paymentType');
    await queryInterface.removeColumn('Transactions', 'status');
    await queryInterface.removeColumn('Transactions', 'userId');
  }
};