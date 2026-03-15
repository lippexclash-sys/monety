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

// ... (mantenha a inicialização do firebase-admin igual ao anterior)

exports.handler = async (event) => {
  console.log("=== WEBHOOK RECEBIDO ===", event.body);
  
  try {
    const body = JSON.parse(event.body);
    const userId = event.queryStringParameters.u; 

    // AJUSTE AQUI: Adicionamos 'COMPLETED' que é o que a EvoPay envia nos logs
    const isPaid = 
      body.status === 'COMPLETED' || 
      body.status === 'PAID' || 
      body.status === 'SUCCESS' || 
      body.success === true;

    if (!isPaid) {
      console.log(`Pagamento ignorado. Status recebido: ${body.status}`);
      return { statusCode: 200, body: 'Pagamento ainda não aprovado' };
    }

    // O restante do código de busca de depósito e atualização de saldo continua igual...
    const depositsRef = db.collection('deposits');
    const snapshot = await depositsRef
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error("Nenhum depósito pendente encontrado para o usuário:", userId);
      return { statusCode: 404, body: 'Deposito nao encontrado' };
    }

    const depositDoc = snapshot.docs[0];
    const amount = depositDoc.data().amount;

    // Atualização do Saldo
    const userRef = db.collection('users').doc(userId);
    
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw "Usuário não existe!";

      const userData = userSnap.data();

      // 1. Aprova o depósito
      transaction.update(depositDoc.ref, { 
        status: 'approved', 
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        gatewayTransactionId: body.id // Salva o ID da EvoPay para referência
      });

      // 2. Adiciona o saldo
      const newBalance = (userData.balance || 0) + amount;
      transaction.update(userRef, { balance: newBalance });
    });

    console.log(`SUCESSO: R$${amount} creditados para o usuário ${userId}`);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error("Erro no processamento do Webhook:", error);
    return { statusCode: 500, body: 'Erro interno' };
  }
};
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
