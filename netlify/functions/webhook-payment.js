const admin = require('firebase-admin');

// Inicialização segura do Firebase
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

const db = admin.apps.length ? admin.firestore() : null;

exports.handler = async (event) => {
  try {
    if (!db) throw new Error("Banco de dados não conectado.");

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const transactionId = body.id || body.reference || (event.queryStringParameters ? event.queryStringParameters.id : null);

    // Retorna JSON padronizado
    if (!transactionId) return { statusCode: 400, body: JSON.stringify({ error: 'ID ausente' }) };

    const statusCeto = String(body.status).toUpperCase();
    const isPaid = statusCeto === 'PAID' || statusCeto === 'COMPLETED' || body.success === true;

    // Retorna JSON padronizado
    if (!isPaid) return { statusCode: 200, body: JSON.stringify({ message: 'Aguardando pagamento' }) };

    const depositRef = db.collection('deposits').doc(transactionId);
    const depositDoc = await depositRef.get();

    if (!depositDoc.exists || depositDoc.data().status === 'approved') {
      return { statusCode: 200, body: JSON.stringify({ message: 'Já processado ou não encontrado' }) };
    }

    const { userId, amount } = depositDoc.data();
    const userRef = db.collection('users').doc(userId);

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
         throw new Error(`Usuário não existe: ${userId}`);
      }

      // 1. Atualiza depósito e saldo do jogador
      transaction.update(depositRef, { status: 'approved', paidAt: admin.firestore.FieldValue.serverTimestamp() });
      transaction.update(userRef, { balance: admin.firestore.FieldValue.increment(Number(amount)) });

      // 2. Atualiza o status do convite na coleção 'invites' (Usando transaction.get para manter consistência)
      const inviteQuery = db.collection('invites')
        .where('invitedId', '==', userId)
        .where('status', '==', 'pending')
        .limit(1);
        
      const inviteSnap = await transaction.get(inviteQuery);
      
      if (!inviteSnap.empty) {
        transaction.update(inviteSnap.docs[0].ref, { status: 'completed' });
      }

      // 3. Distribuição de Comissões em Cadeia
      let currentReferrerId = userSnap.data().referredBy;

      // --- NÍVEL 1 (20%) ---
      if (currentReferrerId) {
        const ref1Ref = db.collection('users').doc(currentReferrerId);
        const ref1Snap = await transaction.get(ref1Ref);
        
        if (ref1Snap.exists) {
          const bonus1 = Number(amount) * 0.20;
          transaction.update(ref1Ref, {
            balance: admin.firestore.FieldValue.increment(bonus1),
            totalCommissions: admin.firestore.FieldValue.increment(bonus1)
          });

          // Pega o pai do Nível 1 para pagar o Nível 2
          currentReferrerId = ref1Snap.data().referredBy;

          // --- NÍVEL 2 (5%) ---
          if (currentReferrerId) {
            const ref2Ref = db.collection('users').doc(currentReferrerId);
            const ref2Snap = await transaction.get(ref2Ref);

            if (ref2Snap.exists) {
              const bonus2 = Number(amount) * 0.05;
              transaction.update(ref2Ref, {
                balance: admin.firestore.FieldValue.increment(bonus2),
                totalCommissions: admin.firestore.FieldValue.increment(bonus2)
              });

              // Pega o pai do Nível 2 para pagar o Nível 3
              currentReferrerId = ref2Snap.data().referredBy;

              // --- NÍVEL 3 (1%) ---
              if (currentReferrerId) {
                const ref3Ref = db.collection('users').doc(currentReferrerId);
                const ref3Snap = await transaction.get(ref3Ref);

                if (ref3Snap.exists) {
                  const bonus3 = Number(amount) * 0.01;
                  transaction.update(ref3Ref, {
                    balance: admin.firestore.FieldValue.increment(bonus3),
                    totalCommissions: admin.firestore.FieldValue.increment(bonus3)
                  });
                }
              }
            }
          }
        }
      }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Processado com sucesso' }) };
  } catch (error) {
    console.error("Erro no processamento:", error);
    // Devolve JSON para o frontend não engasgar
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Erro interno' }) };
  }
};
