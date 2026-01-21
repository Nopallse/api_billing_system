'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('Shifts', 'isWithdrawn', {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            allowNull: false
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('Shifts', 'isWithdrawn');
    }
};
