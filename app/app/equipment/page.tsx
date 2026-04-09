'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { EquipmentCard } from '@/components/equipment/EquipmentCard';
import { MotionPage } from '@/components/motion/MotionPage';
import { StaggerContainer, StaggerItem } from '@/components/motion/StaggerGrid';
import { scaleIn } from '@/components/motion/variants';
import { Button } from '@/components/ui/button';
import { Plus, Loader2, Search, Wrench } from 'lucide-react';

interface Equipment {
  id: string;
  name: string;
  type: string | null;
  serial_number: string | null;
  location: string | null;
  status: 'active' | 'out_of_service' | 'retired';
  next_due_date: string | null;
  last_inspection_date: string | null;
  photo_url: string | null;
}

export default function EquipmentPage() {
  const { organization } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', type: '', serial_number: '', location: '' });
  const [isSaving, setIsSaving] = useState(false);

  const fetchEquipment = useCallback(async () => {
    if (!organization) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false });

    if (!error && data) setEquipment(data);
    setIsLoading(false);
  }, [organization]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (organization) fetchEquipment();
  }, [organization, fetchEquipment]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !formData.name.trim()) return;
    setIsSaving(true);

    const { error } = await supabase.from('equipment').insert({
      organization_id: organization.id,
      name: formData.name.trim(),
      type: formData.type.trim() || null,
      serial_number: formData.serial_number.trim() || null,
      location: formData.location.trim() || null,
    });

    if (!error) {
      setFormData({ name: '', type: '', serial_number: '', location: '' });
      setShowForm(false);
      fetchEquipment();
    }
    setIsSaving(false);
  };

  const filtered = equipment.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
    e.location?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <MotionPage className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Equipment Registry</h1>
          <p className="text-muted-foreground">Manage your fleet&apos;s equipment inventory</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2 rounded-xl shadow-industrial">
          <Plus className="h-4 w-4" /> Add Equipment
        </Button>
      </div>

      {/* Add Form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            onSubmit={handleAdd}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4 overflow-hidden"
          >
            <h3 className="font-semibold font-display text-foreground">New Equipment</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Equipment Name *"
                className="rounded-xl border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              <input
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                placeholder="Type (e.g., Excavator)"
                className="rounded-xl border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              <input
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                placeholder="Serial Number"
                className="rounded-xl border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all font-mono"
              />
              <input
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Location"
                className="rounded-xl border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={isSaving} className="gap-2 rounded-xl">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isSaving ? 'Saving...' : 'Add'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">
                Cancel
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search equipment..."
          className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
      </div>

      {/* Equipment Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading equipment...
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center justify-center py-16 text-muted-foreground"
        >
          <Wrench className="h-16 w-16 mb-4 opacity-20" />
          <p className="font-medium text-lg">{search ? 'No matches found' : 'No equipment yet'}</p>
          <p className="text-sm">{search ? 'Try a different search' : 'Click "Add Equipment" to get started'}</p>
        </motion.div>
      ) : (
        <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <StaggerItem key={item.id}>
              <EquipmentCard equipment={item} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </MotionPage>
  );
}
