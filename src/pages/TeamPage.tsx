import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Users, Copy, Check, Share2, TrendingUp, Award } from 'lucide-react';
import { toast } from 'sonner';

import { db } from "../firebase/firebase"; 
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

interface TeamMember {
  id: string;
  email: string;
  created_at: string;
  status: string;
}

interface TeamData {
  level1: { count: number; totalEarned: number; members: TeamMember[] };
  level2: { count: number; totalEarned: number; members: TeamMember[] };
  level3: { count: number; totalEarned: number; members: TeamMember[] };
}

export default function TeamPage() {
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null); // Para guardar o invite_code
  const [teamData, setTeamData] = useState<TeamData>({
    level1: { count: 0, totalEarned: 0, members: [] },
    level2: { count: 0, totalEarned: 0, members: [] },
    level3: { count: 0, totalEarned: 0, members: [] }
  });
  
  const [loading, setLoading] = useState(true);
  const [activeLevel, setActiveLevel] = useState<1 | 2 | 3>(1);
  const [copied, setCopied] = useState(false);

  // Link corrigido: usa o código vindo do Firestore
  const inviteLink = `${window.location.origin}/?code=${userProfile?.invite_code || ''}`;

  useEffect(() => {
    const userId = user?.uid || user?.id;
    if (userId) {
      loadAllData(userId);
    } else if (user === null) {
      setLoading(false);
    }
  }, [user]);

  const loadAllData = async (userId: string) => {
    setLoading(true);
    try {
      // 1. Busca o perfil do usuário logado para ter o invite_code
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        setUserProfile(userDoc.data());
      }

      // 2. Inicia a busca da equipe
      await fetchRealTeamData(userId);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRealTeamData = async (userId: string) => {
    const invitesRef = collection(db, 'invites');
    
    // --- NÍVEL 1 ---
    const q1 = query(invitesRef, where('inviterId', '==', userId));
    const snap1 = await getDocs(q1);
    const l1Data = snap1.docs.map(d => d.data());
    const l1Ids = l1Data.map(d => d.invitedId);

    // --- NÍVEL 2 (Busca em paralelo) ---
    const l2Promises = l1Ids.map(id => getDocs(query(invitesRef, where('inviterId', '==', id))));
    const snap2Array = await Promise.all(l2Promises);
    const l2Data = snap2Array.flatMap(s => s.docs.map(d => d.data()));
    const l2Ids = l2Data.map(d => d.invitedId);

    // --- NÍVEL 3 (Busca em paralelo) ---
    const l3Promises = l2Ids.map(id => getDocs(query(invitesRef, where('inviterId', '==', id))));
    const snap3Array = await Promise.all(l3Promises);
    const l3Data = snap3Array.flatMap(s => s.docs.map(d => d.data()));
    const l3Ids = l3Data.map(d => d.invitedId);

    // --- BUSCA DE EMAILS OTIMIZADA ---
    const allUniqueIds = Array.from(new Set([...l1Ids, ...l2Ids, ...l3Ids]));
    const emailMap: Record<string, string> = {};
    
    // Busca todos os usuários de uma vez (em paralelo)
    await Promise.all(allUniqueIds.map(async (id) => {
      const uDoc = await getDoc(doc(db, 'users', id));
      emailMap[id] = uDoc.exists() ? uDoc.data().email : 'Usuário Oculto';
    }));

    // Formatação final
    const format = (data: any[]) => data.map(d => ({
      id: d.invitedId,
      email: emailMap[d.invitedId] || 'Usuário Oculto',
      status: d.status || 'pending',
      created_at: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString()
    }));

    const m1 = format(l1Data);
    const m2 = format(l2Data);
    const m3 = format(l3Data);

    const calc = (m: TeamMember[], val: number) => m.filter(x => x.status !== 'pending').length * val;

    setTeamData({
      level1: { count: m1.length, totalEarned: calc(m1, 10), members: m1 },
      level2: { count: m2.length, totalEarned: calc(m2, 5), members: m2 },
      level3: { count: m3.length, totalEarned: calc(m3, 2), members: m3 }
    });
  };

  const handleCopyCode = () => {
    if (userProfile?.invite_code) {
      navigator.clipboard.writeText(userProfile.invite_code);
      setCopied(true);
      toast.success('Código copiado!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Junte-se ao Monety',
        text: `Use meu código: ${userProfile?.invite_code}`,
        url: inviteLink
      });
    } else {
      navigator.clipboard.writeText(inviteLink);
      toast.success('Link copiado!');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-white">Carregando sua equipe...</p>
      </div>
    );
  }

  const currentLevel = teamData[`level${activeLevel}` as keyof TeamData];
  const percentage = activeLevel === 1 ? 20 : activeLevel === 2 ? 5 : 1;
  const totalReferrals = teamData.level1.count + teamData.level2.count + teamData.level3.count;
  const totalEarnings = teamData.level1.totalEarned + teamData.level2.totalEarned + teamData.level3.totalEarned;

  return (
    <div className="space-y-6 pb-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Minha Equipe</h1>
        <p className="text-gray-400 text-sm">Convide amigos e ganhe comissões</p>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-[#111111]/80 border-[#1a1a1a]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-[#22c55e]" />
              <span className="text-gray-400 text-sm">Convidados</span>
            </div>
            <p className="text-2xl font-bold text-white">{totalReferrals}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#111111]/80 border-[#1a1a1a]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-[#22c55e]" />
              <span className="text-gray-400 text-sm">Ganhos</span>
            </div>
            <p className="text-2xl font-bold text-[#22c55e]">R$ {totalEarnings.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Link de Convite (Onde estava o erro de undefined) */}
      <Card className="bg-[#111111]/80 border-[#1a1a1a]">
        <CardHeader><CardTitle className="text-white text-sm">Seu Link de Convite</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-[#0a0a0a] rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">Código:</p>
            <p className="text-[#22c55e] font-bold">{userProfile?.invite_code || 'Buscando...'}</p>
          </div>
          <div className="bg-[#0a0a0a] rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">Link:</p>
            <p className="text-gray-300 text-xs break-all">{inviteLink}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={handleCopyCode} className="bg-[#1a1a1a] text-white border border-[#2a2a2a]">
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <Button onClick={handleShare} className="bg-gradient-to-r from-[#22c55e] to-[#16a34a] text-white">
              <Share2 className="w-4 h-4 mr-2" /> Compartilhar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Convidados */}
      <Card className="bg-[#111111]/80 border-[#1a1a1a]">
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 2, 3].map((l) => (
              <button
                key={l}
                onClick={() => setActiveLevel(l as any)}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${activeLevel === l ? 'bg-[#22c55e] text-white' : 'bg-[#0a0a0a] text-gray-500'}`}
              >
                Nível {l} ({teamData[`level${l as 1|2|3}`].count})
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {currentLevel.members.length > 0 ? (
              currentLevel.members.map((m) => (
                <div key={m.id} className="flex justify-between items-center bg-[#0a0a0a] p-3 rounded-lg border border-[#1a1a1a]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#22c55e]/10 rounded-full flex items-center justify-center text-[#22c55e] font-bold text-xs">
                      {m.email[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-xs font-medium">{m.email}</p>
                      <p className="text-gray-600 text-[10px]">ID: {m.id.slice(0,8)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[#22c55e] text-xs font-bold">{percentage}%</span>
                    <p className="text-gray-600 text-[10px]">{new Date(m.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-gray-500 py-4 text-sm">Nenhum convidado aqui ainda.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
