'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Members', 'deposit', {
      type: Sequelize.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Member deposit balance'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Members', 'deposit');
  }
};
