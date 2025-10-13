'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Ubah kolom end dari TIME ke DATE
    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.DATE,
      allowNull: true
    });
    
    // Juga ubah kolom start dari TIME ke DATE untuk konsistensi
    await queryInterface.changeColumn('Transactions', 'start', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    // Rollback: ubah kembali ke TIME
    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.TIME,
      allowNull: true
    });
    
    await queryInterface.changeColumn('Transactions', 'start', {
      type: Sequelize.TIME,
      allowNull: true
    });
  }
};