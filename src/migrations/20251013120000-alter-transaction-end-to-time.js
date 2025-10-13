'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    // Ubah kolom end dari DATE kembali ke TIME
    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.TIME,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Rollback: ubah kolom end kembali ke DATE
    await queryInterface.changeColumn('Transactions', 'end', {
      type: Sequelize.DATE,
      allowNull: true
    });
  }
};