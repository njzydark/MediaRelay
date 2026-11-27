use std::{collections::HashMap, hash::Hash, time::Duration};

use tokio::time::Instant;

pub struct Entry<V> {
    pub value: V,
    pub expires: Instant,
    touched: u64,
}

pub struct Cache<K, V> {
    pub entries: HashMap<K, Entry<V>>,
    clock: u64,
    capacity: usize,
}

impl<K: Eq + Hash + Clone, V: Clone> Cache<K, V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            capacity,
        }
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        let now = Instant::now();
        self.prune_at(now);
        self.clock = self.clock.wrapping_add(1);
        self.entries.get_mut(key).map(|entry| {
            entry.touched = self.clock;
            entry.value.clone()
        })
    }

    pub fn insert(&mut self, key: K, value: V, ttl: Duration) {
        let now = Instant::now();
        self.prune_at(now);
        if ttl.is_zero() {
            return;
        }
        if self.entries.len() >= self.capacity
            && !self.entries.contains_key(&key)
            && let Some(key) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.touched)
                .map(|(key, _)| key.clone())
        {
            self.entries.remove(&key);
        }
        self.clock = self.clock.wrapping_add(1);
        self.entries.insert(
            key,
            Entry {
                value,
                expires: now + ttl,
                touched: self.clock,
            },
        );
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
    pub fn prune(&mut self) {
        self.prune_at(Instant::now());
    }

    fn prune_at(&mut self, now: Instant) {
        self.entries.retain(|_, entry| entry.expires > now);
    }
}
