'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Change deposit column from DECIMAL(15,2) to INTEGER
    await queryInterface.changeColumn('Members', 'deposit', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert back to DECIMAL(15,2)
    await queryInterface.changeColumn('Members', 'deposit', {
      type: Sequelize.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    });
  }
};