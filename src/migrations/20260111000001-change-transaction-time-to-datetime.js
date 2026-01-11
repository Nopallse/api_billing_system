'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Ubah kolom start dari TIME ke DATETIME
    await queryInterface.changeColumn('Transactions', 'start', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Ubah kolom end dari TIME ke DATETIME
    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.DATE,
      allowNull: true
    });

    console.log('✅ Changed start and end columns from TIME to DATETIME');
  },

  async down(queryInterface, Sequelize) {
    // Rollback: ubah kembali ke TIME
    await queryInterface.changeColumn('Transactions', 'start', {
      type: Sequelize.TIME,
      allowNull: true
    });

    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.TIME,
      allowNull: true
    });

    console.log('⏪ Rolled back start and end columns to TIME');
  }
};
