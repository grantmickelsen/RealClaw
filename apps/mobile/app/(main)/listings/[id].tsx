import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authedFetch } from '../../../lib/api';

type Status = 'active' | 'pending' | 'sold' | 'archived';

interface ListingForm {
  address: string;
  city: string;
  state: string;
  zip: string;
  status: Status;
  price: string;
  beds: string;
  baths: string;
  halfBaths: string;
  sqft: string;
  lotSqft: string;
  yearBuilt: string;
  propertyType: string;
  mlsNumber: string;
  listingDate: string;
  description: string;
  features: string[];
  // Advanced
  estimatedValue: string;
  lastSalePrice: string;
  lastSaleDate: string;
  taxAssessedValue: string;
  taxAmount: string;
  hoaMonthly: string;
  schoolDistrict: string;
  floodZone: string;
  stories: string;
  garageSpaces: string;
  pool: boolean;
  spa: boolean;
  roofType: string;
  constructionType: string;
  foundation: string;
  heating: string;
  cooling: string;
}

const BLANK: ListingForm = {
  address: '', city: '', state: '', zip: '', status: 'active',
  price: '', beds: '', baths: '', halfBaths: '', sqft: '', lotSqft: '',
  yearBuilt: '', propertyType: '', mlsNumber: '', listingDate: '',
  description: '', features: [],
  estimatedValue: '', lastSalePrice: '', lastSaleDate: '',
  taxAssessedValue: '', taxAmount: '', hoaMonthly: '',
  schoolDistrict: '', floodZone: '', stories: '', garageSpaces: '',
  pool: false, spa: false,
  roofType: '', constructionType: '', foundation: '', heating: '', cooling: '',
};

const STATUS_OPTIONS: Status[] = ['active', 'pending', 'sold', 'archived'];

function rowFromApi(data: Record<string, unknown>): ListingForm {
  const adv = (data['advanced_data'] ?? {}) as Record<string, unknown>;
  const feats = Array.isArray(data['features']) ? (data['features'] as string[]) : [];
  return {
    address: String(data['address'] ?? ''),
    city: String(data['city'] ?? ''),
    state: String(data['state'] ?? ''),
    zip: String(data['zip'] ?? ''),
    status: (data['status'] as Status) ?? 'active',
    price: data['price'] != null ? String(data['price']) : '',
    beds: data['beds'] != null ? String(data['beds']) : '',
    baths: data['baths'] != null ? String(data['baths']) : '',
    halfBaths: data['half_baths'] != null ? String(data['half_baths']) : '',
    sqft: data['sqft'] != null ? String(data['sqft']) : '',
    lotSqft: data['lot_sqft'] != null ? String(data['lot_sqft']) : '',
    yearBuilt: data['year_built'] != null ? String(data['year_built']) : '',
    propertyType: String(data['property_type'] ?? ''),
    mlsNumber: String(data['mls_number'] ?? ''),
    listingDate: String(data['listing_date'] ?? ''),
    description: String(data['description'] ?? ''),
    features: feats,
    estimatedValue: adv['estimatedValue'] != null ? String(adv['estimatedValue']) : '',
    lastSalePrice: adv['lastSalePrice'] != null ? String(adv['lastSalePrice']) : '',
    lastSaleDate: String(adv['lastSaleDate'] ?? ''),
    taxAssessedValue: adv['taxAssessedValue'] != null ? String(adv['taxAssessedValue']) : '',
    taxAmount: adv['taxAmount'] != null ? String(adv['taxAmount']) : '',
    hoaMonthly: adv['hoaMonthly'] != null ? String(adv['hoaMonthly']) : '',
    schoolDistrict: String(adv['schoolDistrict'] ?? ''),
    floodZone: String(adv['floodZone'] ?? ''),
    stories: adv['stories'] != null ? String(adv['stories']) : '',
    garageSpaces: adv['garageSpaces'] != null ? String(adv['garageSpaces']) : '',
    pool: Boolean(adv['pool']),
    spa: Boolean(adv['spa']),
    roofType: String(adv['roofType'] ?? ''),
    constructionType: String(adv['constructionType'] ?? ''),
    foundation: String(adv['foundation'] ?? ''),
    heating: String(adv['heating'] ?? ''),
    cooling: String(adv['cooling'] ?? ''),
  };
}

function buildPatchBody(f: ListingForm) {
  return {
    address: f.address,
    city: f.city,
    state: f.state,
    zip: f.zip,
    status: f.status,
    price: f.price ? Number(f.price) : null,
    beds: f.beds ? Number(f.beds) : null,
    baths: f.baths ? Number(f.baths) : null,
    halfBaths: f.halfBaths ? Number(f.halfBaths) : null,
    sqft: f.sqft ? Number(f.sqft) : null,
    lotSqft: f.lotSqft ? Number(f.lotSqft) : null,
    yearBuilt: f.yearBuilt ? Number(f.yearBuilt) : null,
    propertyType: f.propertyType || null,
    mlsNumber: f.mlsNumber || null,
    listingDate: f.listingDate || null,
    description: f.description || null,
    features: f.features,
    advancedData: {
      ...(f.estimatedValue ? { estimatedValue: Number(f.estimatedValue) } : {}),
      ...(f.lastSalePrice ? { lastSalePrice: Number(f.lastSalePrice) } : {}),
      ...(f.lastSaleDate ? { lastSaleDate: f.lastSaleDate } : {}),
      ...(f.taxAssessedValue ? { taxAssessedValue: Number(f.taxAssessedValue) } : {}),
      ...(f.taxAmount ? { taxAmount: Number(f.taxAmount) } : {}),
      ...(f.hoaMonthly ? { hoaMonthly: Number(f.hoaMonthly) } : {}),
      ...(f.schoolDistrict ? { schoolDistrict: f.schoolDistrict } : {}),
      ...(f.floodZone ? { floodZone: f.floodZone } : {}),
      ...(f.stories ? { stories: Number(f.stories) } : {}),
      ...(f.garageSpaces ? { garageSpaces: Number(f.garageSpaces) } : {}),
      pool: f.pool,
      spa: f.spa,
      ...(f.roofType ? { roofType: f.roofType } : {}),
      ...(f.constructionType ? { constructionType: f.constructionType } : {}),
      ...(f.foundation ? { foundation: f.foundation } : {}),
      ...(f.heating ? { heating: f.heating } : {}),
      ...(f.cooling ? { cooling: f.cooling } : {}),
    },
  };
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        style={[fieldStyles.input, multiline && fieldStyles.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ''}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { flex: 1, gap: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minHeight: 44,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
});

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [form, setForm] = useState<ListingForm>(BLANK);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [advExpanded, setAdvExpanded] = useState(false);
  const [newFeature, setNewFeature] = useState('');

  useEffect(() => {
    if (isNew) return;
    authedFetch(`/v1/listings/${id}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then(data => setForm(rowFromApi(data as Record<string, unknown>)))
      .catch(() => { Alert.alert('Error', 'Could not load listing.'); router.back(); })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const set = useCallback(<K extends keyof ListingForm>(key: K, val: ListingForm[K]) => {
    setForm(f => ({ ...f, [key]: val }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.address.trim()) {
      Alert.alert('Address required', 'Please enter a property address.');
      return;
    }
    setSaving(true);
    try {
      const body = buildPatchBody(form);
      let res: Response;
      if (isNew) {
        res = await authedFetch('/v1/listings', { method: 'POST', body: JSON.stringify(body) });
      } else {
        res = await authedFetch(`/v1/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      if (!res.ok) throw new Error('Save failed');
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save listing. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, id, isNew]);

  const handleRentCastImport = useCallback(async () => {
    if (!form.address.trim()) {
      Alert.alert('Address needed', 'Enter an address first to import from RentCast.');
      return;
    }
    setImporting(true);
    try {
      const res = await authedFetch('/v1/listings/rentcast-lookup', {
        method: 'POST',
        body: JSON.stringify({ address: form.address, zipCode: form.zip || undefined }),
      });
      if (!res.ok) throw new Error('Lookup failed');
      const data = await res.json() as Record<string, unknown>;
      const merged = rowFromApi({ ...buildPatchBody(form), ...data, features: form.features });
      setForm(merged);
      Alert.alert('Imported', 'Property data imported from RentCast.');
    } catch {
      Alert.alert('RentCast unavailable', 'Could not retrieve property data. Check your RentCast integration.');
    } finally {
      setImporting(false);
    }
  }, [form]);

  const handleAddFeature = useCallback(() => {
    const f = newFeature.trim();
    if (!f) return;
    setForm(prev => ({ ...prev, features: [...prev.features, f] }));
    setNewFeature('');
  }, [newFeature]);

  const handleRemoveFeature = useCallback((idx: number) => {
    setForm(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== idx) }));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color="#0066FF" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {isNew ? 'New Listing' : (form.address || 'Listing')}
        </Text>
        <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={() => void handleSave()} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Section 1: Property Info ── */}
        <Text style={styles.sectionLabel}>Property Info</Text>
        <View style={styles.card}>
          <Field label="Address" value={form.address} onChangeText={v => set('address', v)} placeholder="123 Main St" />
          <View style={styles.row}>
            <Field label="City" value={form.city} onChangeText={v => set('city', v)} placeholder="Santa Barbara" />
            <Field label="State" value={form.state} onChangeText={v => set('state', v)} placeholder="CA" />
          </View>
          <View style={styles.row}>
            <Field label="ZIP" value={form.zip} onChangeText={v => set('zip', v)} placeholder="93101" keyboardType="numeric" />
            <Field label="Property Type" value={form.propertyType} onChangeText={v => set('propertyType', v)} placeholder="Single Family" />
          </View>

          {/* Status segmented control */}
          <View style={fieldStyles.wrap}>
            <Text style={fieldStyles.label}>Status</Text>
            <View style={styles.segmentRow}>
              {STATUS_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.segment, form.status === s && styles.segmentActive]}
                  onPress={() => set('status', s)}
                >
                  <Text style={[styles.segmentText, form.status === s && styles.segmentTextActive]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Field label="List Price ($)" value={form.price} onChangeText={v => set('price', v)} placeholder="1250000" keyboardType="numeric" />
          <View style={styles.row}>
            <Field label="Beds" value={form.beds} onChangeText={v => set('beds', v)} placeholder="3" keyboardType="numeric" />
            <Field label="Baths" value={form.baths} onChangeText={v => set('baths', v)} placeholder="2" keyboardType="decimal-pad" />
            <Field label="Half Baths" value={form.halfBaths} onChangeText={v => set('halfBaths', v)} placeholder="1" keyboardType="numeric" />
          </View>
          <View style={styles.row}>
            <Field label="Sqft" value={form.sqft} onChangeText={v => set('sqft', v)} placeholder="1800" keyboardType="numeric" />
            <Field label="Lot Sqft" value={form.lotSqft} onChangeText={v => set('lotSqft', v)} placeholder="6000" keyboardType="numeric" />
          </View>
          <View style={styles.row}>
            <Field label="Year Built" value={form.yearBuilt} onChangeText={v => set('yearBuilt', v)} placeholder="1985" keyboardType="numeric" />
            <Field label="MLS #" value={form.mlsNumber} onChangeText={v => set('mlsNumber', v)} placeholder="SB24001234" />
          </View>
          <Field label="Listing Date" value={form.listingDate} onChangeText={v => set('listingDate', v)} placeholder="2026-05-01" />
        </View>

        {/* ── RentCast Import ── */}
        <TouchableOpacity
          style={[styles.importBtn, importing && styles.btnDisabled]}
          onPress={() => void handleRentCastImport()}
          disabled={importing}
        >
          {importing
            ? <ActivityIndicator color="#0066FF" size="small" />
            : <Text style={styles.importBtnText}>↓ Import from RentCast</Text>}
        </TouchableOpacity>

        {/* ── Section 2: Content ── */}
        <Text style={styles.sectionLabel}>Content</Text>
        <View style={styles.card}>
          <Field label="Description" value={form.description} onChangeText={v => set('description', v)} multiline placeholder="Charming 3BR/2BA in the heart of…" />

          <View style={fieldStyles.wrap}>
            <Text style={fieldStyles.label}>Key Features</Text>
            <View style={styles.tagContainer}>
              {form.features.map((feat, idx) => (
                <TouchableOpacity key={idx} style={styles.tag} onPress={() => handleRemoveFeature(idx)}>
                  <Text style={styles.tagText}>{feat} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                value={newFeature}
                onChangeText={setNewFeature}
                placeholder="Add a feature…"
                placeholderTextColor="#9CA3AF"
                returnKeyType="done"
                onSubmitEditing={handleAddFeature}
              />
              <TouchableOpacity style={styles.tagAddBtn} onPress={handleAddFeature}>
                <Text style={styles.tagAddBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Section 3: Advanced (collapsible) ── */}
        <TouchableOpacity style={styles.advHeader} onPress={() => setAdvExpanded(e => !e)}>
          <Text style={styles.sectionLabel}>Advanced Data {advExpanded ? '▲' : '▾'}</Text>
        </TouchableOpacity>

        {advExpanded && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Field label="Est. Value ($)" value={form.estimatedValue} onChangeText={v => set('estimatedValue', v)} keyboardType="numeric" />
              <Field label="Last Sale Price ($)" value={form.lastSalePrice} onChangeText={v => set('lastSalePrice', v)} keyboardType="numeric" />
            </View>
            <Field label="Last Sale Date" value={form.lastSaleDate} onChangeText={v => set('lastSaleDate', v)} placeholder="2020-06-15" />
            <View style={styles.row}>
              <Field label="Tax Assessed ($)" value={form.taxAssessedValue} onChangeText={v => set('taxAssessedValue', v)} keyboardType="numeric" />
              <Field label="Annual Tax ($)" value={form.taxAmount} onChangeText={v => set('taxAmount', v)} keyboardType="numeric" />
            </View>
            <View style={styles.row}>
              <Field label="HOA/mo ($)" value={form.hoaMonthly} onChangeText={v => set('hoaMonthly', v)} keyboardType="numeric" />
              <Field label="Flood Zone" value={form.floodZone} onChangeText={v => set('floodZone', v)} placeholder="AE" />
            </View>
            <Field label="School District" value={form.schoolDistrict} onChangeText={v => set('schoolDistrict', v)} />
            <View style={styles.row}>
              <Field label="Stories" value={form.stories} onChangeText={v => set('stories', v)} keyboardType="numeric" />
              <Field label="Garage Spaces" value={form.garageSpaces} onChangeText={v => set('garageSpaces', v)} keyboardType="numeric" />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Pool</Text>
              <Switch value={form.pool} onValueChange={v => set('pool', v)} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Spa / Hot Tub</Text>
              <Switch value={form.spa} onValueChange={v => set('spa', v)} />
            </View>

            <View style={styles.row}>
              <Field label="Roof Type" value={form.roofType} onChangeText={v => set('roofType', v)} placeholder="Asphalt Shingle" />
              <Field label="Construction" value={form.constructionType} onChangeText={v => set('constructionType', v)} placeholder="Wood Frame" />
            </View>
            <View style={styles.row}>
              <Field label="Foundation" value={form.foundation} onChangeText={v => set('foundation', v)} placeholder="Slab" />
              <Field label="Heating" value={form.heating} onChangeText={v => set('heating', v)} placeholder="Central" />
            </View>
            <Field label="Cooling" value={form.cooling} onChangeText={v => set('cooling', v)} placeholder="Central A/C" />
          </View>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  backBtn: { minWidth: 60 },
  backText: { fontSize: 17, color: '#0066FF' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  saveBtn: {
    minWidth: 60,
    backgroundColor: '#0066FF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },

  scroll: { padding: 16, gap: 12 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  row: { flexDirection: 'row', gap: 10 },

  segmentRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  segmentActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  segmentText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  segmentTextActive: { color: '#fff' },

  importBtn: {
    marginVertical: 4,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  importBtnText: { color: '#0066FF', fontWeight: '700', fontSize: 15 },

  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  tagText: { fontSize: 13, color: '#0066FF', fontWeight: '500' },
  tagInputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  tagInput: {
    flex: 1,
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  tagAddBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  tagAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  advHeader: { marginTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
});
