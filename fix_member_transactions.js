const { Transaction } = require('./src/models');

async function fixMemberTransactions() {
    try {
        console.log('Fixing member transactions...');
        
        // Update semua transaksi yang memiliki memberId tapi isMemberTransaction masih false
        const [updatedCount] = await Transaction.update(
            { isMemberTransaction: true },
            { 
                where: { 
                    memberId: { [require('sequelize').Op.ne]: null },
                    isMemberTransaction: false
                }
            }
        );
        
        console.log(`Successfully updated ${updatedCount} transactions`);
        
        // Tampilkan hasil
        const memberTransactions = await Transaction.findAll({
            where: { 
                memberId: { [require('sequelize').Op.ne]: null }
            },
            attributes: ['id', 'memberId', 'isMemberTransaction']
        });
        
        console.log('Current member transactions:');
        console.table(memberTransactions.map(t => ({
            id: t.id.substring(0, 8) + '...',
            memberId: t.memberId ? t.memberId.substring(0, 8) + '...' : null,
            isMemberTransaction: t.isMemberTransaction
        })));
        
    } catch (error) {
        console.error('Error fixing member transactions:', error);
    }
}

fixMemberTransactions();