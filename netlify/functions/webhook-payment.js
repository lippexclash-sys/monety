const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  console.log("=== WEBHOOK RECEBIDO ===");
  
  try {
    const body = JSON.parse(event.body);
    const userId = event.queryStringParameters ? event.queryStringParameters.u : null;

    if (!userId) {
      console.error("ERRO: ID do usuário (u) não enviado na URL");
      return { statusCode: 400, body: 'Falta ID do usuario' };
    }

    // Verifica status da EvoPay
    const isPaid = body.status === 'COMPLETED' || body.status === 'PAID' || body.success === true;

    if (!isPaid) {
      console.log(`Pagamento ainda pendente no gateway: ${body.status}`);
      return { statusCode: 200, body: 'Aguardando aprovacao' };
    }

    // Busca o depósito pendente
    const depositsRef = db.collection('deposits');
    const snapshot = await depositsRef
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error(`Nenhum deposito pendente para o user: ${userId}`);
      return { statusCode: 404, body: 'Nao encontrado' };
    }

    const depositDoc = snapshot.docs[0];
    const amount = depositDoc.data().amount;
    const userRef = db.collection('users').doc(userId);

    // Transação para garantir que tudo atualize junto
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw "Usuario nao existe no DB";

      // 1. Atualiza depósito
      transaction.update(depositDoc.ref, { 
        status: 'approved', 
        paidAt: admin.firestore.FieldValue.serverTimestamp() 
      });

      // 2. Atualiza saldo
      transaction.update(userRef, { 
        balance: admin.firestore.FieldValue.increment(amount) 
      });

      // 3. Comissão (Opcional - Exemplo Nível 1)
      const userData = userSnap.data();
      if (userData.referredBy) {
        const refRef = db.collection('users').doc(userData.referredBy);
        transaction.update(refRef, { 
          balance: admin.firestore.FieldValue.increment(amount * 0.20), // 10% de exemplo
          totalCommissions: admin.firestore.FieldValue.increment(amount * 0.10)
        });
      }
    });

    console.log(`SUCESSO: R$${amount} creditado para ${userId}`);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error("ERRO NO PROCESSAMENTO:", error);
    return { statusCode: 500, body: 'Erro interno' };
  }
};
