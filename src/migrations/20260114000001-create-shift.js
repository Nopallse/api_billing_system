'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('Shifts', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4
            },
            userId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'Users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            startTime: {
                allowNull: false,
                type: Sequelize.DATE
            },
            endTime: {
                allowNull: true,
                type: Sequelize.DATE
            },
            initialCash: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            finalCash: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            expectedCash: {
                type: Sequelize.INTEGER,
                allowNull: true,
                comment: 'Total calculated cash from system (initial + cash payments)'
            },
            status: {
                type: Sequelize.ENUM('open', 'closed'),
                allowNull: false,
                defaultValue: 'open'
            },
            note: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex('Shifts', ['userId']);
        await queryInterface.addIndex('Shifts', ['status']);
    },
    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('Shifts');
    }
};
