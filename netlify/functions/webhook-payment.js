const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  }
}

const db = admin.firestore();

exports.handler = async (event) => {
  // 1. Log para depuração (ver o que a EvoPay está enviando)
  console.log("=== WEBHOOK RECEBIDO ===", event.body);
  
  try {
    const body = JSON.parse(event.body);
    const userId = event.queryStringParameters.u; // Pegamos o ID que você passou na URL

    // A EvoPay geralmente envia status 'PAID' ou 'SUCCESS'
    const isPaid = body.status === 'PAID' || body.status === 'SUCCESS' || body.success === true;

    if (!isPaid) {
      return { statusCode: 200, body: 'Pagamento ainda não aprovado' };
    }

    // 2. Localizar o depósito pendente no Firestore
    // Buscamos o depósito mais recente 'pending' deste usuário
    const depositsRef = db.collection('deposits');
    const snapshot = await depositsRef
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error("Nenhum depósito pendente encontrado para este usuário.");
      return { statusCode: 404, body: 'Deposito nao encontrado' };
    }

    const depositDoc = snapshot.docs[0];
    const depositData = depositDoc.data();
    const amount = depositData.amount;

    // 3. ATUALIZAÇÃO ATÔMICA (Evita erros de saldo)
    const userRef = db.collection('users').doc(userId);
    
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw "Usuário não existe!";

      const userData = userSnap.data();

      // A) Aprova o depósito
      transaction.update(depositDoc.ref, { 
        status: 'approved', 
        paidAt: admin.firestore.FieldValue.serverTimestamp() 
      });

      // B) Adiciona o saldo ao usuário
      const newBalance = (userData.balance || 0) + amount;
      transaction.update(userRef, { balance: newBalance });
      
      console.log(`Saldo atualizado: +R$${amount} para o usuário ${userId}`);

      // C) LÓGICA DE COMISSÃO DE EQUIPE (Opcional, mas recomendado para o seu projeto)
      // Se o usuário foi indicado por alguém (Nível 1)
      if (userData.referredBy) {
        const ref1Ref = db.collection('users').doc(userData.referredBy);
        const bonus1 = amount * 0.20; // 20%
        transaction.update(ref1Ref, { 
          balance: admin.firestore.FieldValue.increment(bonus1),
          totalCommissions: admin.firestore.FieldValue.increment(bonus1)
        });

        // Nível 2
        const ref1Snap = await transaction.get(ref1Ref);
        if (ref1Snap.exists() && ref1Snap.data().referredBy) {
          const ref2Ref = db.collection('users').doc(ref1Snap.data().referredBy);
          const bonus2 = amount * 0.05; // 5%
          transaction.update(ref2Ref, { 
            balance: admin.firestore.FieldValue.increment(bonus2),
            totalCommissions: admin.firestore.FieldValue.increment(bonus2)
          });

          // Nível 3
          const ref2Snap = await transaction.get(ref2Ref);
          if (ref2Snap.exists() && ref2Snap.data().referredBy) {
            const ref3Ref = db.collection('users').doc(ref2Snap.data().referredBy);
            const bonus3 = amount * 0.01; // 1%
            transaction.update(ref3Ref, { 
              balance: admin.firestore.FieldValue.increment(bonus3),
              totalCommissions: admin.firestore.FieldValue.increment(bonus3)
            });
          }
        }
      }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error("Erro no Webhook:", error);
    return { statusCode: 500, body: 'Erro interno' };
  }
};
