import json
import os

# --- CONFIGURACIÓN ---
INPUT_FILE = 'kanjiapi_full.json'
OUTPUT_FILE = 'kanjiapi_small.json'

# Campos que mantendremos para ahorrar espacio
# (Eliminamos 'unicode', 'heisig', 'notes', etc.)
KANJI_FIELDS_TO_KEEP = {
    'kanji', 'jlpt', 'meanings', 'kun_readings', 
    'on_readings', 'stroke_count', 'grade'
}

# Configuración de Dificultad (Para filtrar palabras demasiado complejas para su nivel)
KOTOBA_KANJI_MAX_DIFFICULTY = {
    5: (6, 1, 10),   # (Max trazos por kanji, Max grado, Max trazos totales)
    4: (8, 2, 15),
    3: (10, 4, 20),
    2: (12, 6, 24),
    1: (14, 8, 28),
}

# --- FUNCIONES DE AYUDA ---

def is_char_kanji(char):
    return '\u4e00' <= char <= '\u9faf'

def contains_at_least_one_kanji(word_str):
    if not word_str: return False
    return any(is_char_kanji(char) for char in word_str)

def is_katakana_kanji_compound(word_str):
    # Detecta palabras mezcla de Katakana + Kanji (ej. "サボる") que suelen ser raras/slang
    has_katakana = any('ァ' <= char <= 'ヶ' for char in word_str)
    has_kanji = contains_at_least_one_kanji(word_str)
    return has_katakana and has_kanji

def get_word_highest_jlpt_level(word_str, kanji_db):
    """
    Determina el nivel de la palabra basándose en el kanji más difícil que contiene.
    N5 (Fácil) ... N1 (Difícil).
    Devuelve el nivel numérico (1-5).
    """
    levels = []
    for char in word_str:
        if is_char_kanji(char):
            details = kanji_db.get(char)
            # Si un kanji no tiene datos o no tiene nivel JLPT, la palabra se descarta
            if not details or details.get('jlpt') is None:
                return None 
            levels.append(details.get('jlpt'))
    
    if not levels: return None
    # En JLPT, el número más bajo (1) es el más difícil.
    # Pero para clasificar "en qué nivel aparece", usamos el mínimo nivel (el más difícil)
    # Ejemplo: Si tiene un kanji N5 y uno N1, la palabra es N1.
    return min(levels)

def word_meets_complexity_criteria(word_str, target_level, kanji_db):
    """
    Filtra palabras que, aunque tengan kanjis del nivel correcto,
    son visualmente demasiado complejas o usan combinaciones raras (Grado escolar alto).
    """
    thresholds = KOTOBA_KANJI_MAX_DIFFICULTY.get(target_level)
    if not thresholds: return False

    max_strokes_per_kanji, max_grade_per_kanji, max_total_strokes = thresholds
    total_strokes = 0

    for char in word_str:
        details = kanji_db.get(char)
        if not details: continue

        stroke_count = details.get('stroke_count', 99)
        if stroke_count > max_strokes_per_kanji: return False
        total_strokes += stroke_count

        grade = details.get('grade')
        actual_grade = grade if grade is not None else 9
        if actual_grade > max_grade_per_kanji: return False

    if total_strokes > max_total_strokes: return False
    return True

# --- PROCESO PRINCIPAL ---

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(base_dir, INPUT_FILE)
    output_path = os.path.join(base_dir, OUTPUT_FILE)

    print(f"📂 Leyendo: {INPUT_FILE} ...")
    
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: No se encuentra '{INPUT_FILE}' en la carpeta.")
        return

    full_kanjis = data.get('kanjis', {})
    full_words = data.get('words', {})
    
    print(f"📊 Datos originales cargados: {len(full_kanjis)} Kanjis, {len(full_words)} Palabras.")

    # 1. OPTIMIZAR KANJIS
    print("🔨 Optimizando Kanjis (Filtrando solo JLPT N5-N1)...")
    optimized_kanjis = {}
    
    for char, details in full_kanjis.items():
        # Solo guardamos kanjis que tengan nivel JLPT definido
        if details.get('jlpt') is not None:
            # Crear diccionario limpio solo con campos necesarios
            clean_details = {k: v for k, v in details.items() if k in KANJI_FIELDS_TO_KEEP}
            optimized_kanjis[char] = clean_details

    print(f"   ✅ Kanjis retenidos: {len(optimized_kanjis)}")

    # 2. OPTIMIZAR PALABRAS
    print("🔨 Optimizando Palabras (Aplicando filtros de dificultad y limpieza)...")
    optimized_words = {}
    count_valid_words = 0
    
    # Pre-calcular claves para barra de progreso simple o log
    total_raw_words = len(full_words)
    
    for word_key, word_data_list in full_words.items():
        if not isinstance(word_data_list, list): continue
        
        valid_entries = []

        for word_obj in word_data_list:
            variants = word_obj.get('variants', [])
            meanings = word_obj.get('meanings', [])
            
            # Validación básica
            if not variants or not meanings: continue

            written_word = variants[0].get('written')
            reading = variants[0].get('pronounced', '')

            # --- FILTROS ESTRICTOS ---
            if not written_word: continue
            
            # 1. Debe tener Kanji
            if not contains_at_least_one_kanji(written_word): continue
            
            # 2. No debe ser mezcla rara con Katakana
            if is_katakana_kanji_compound(written_word): continue
            
            # 3. Validar Lectura (no debe ser igual a la escritura, ni contener partículas raras)
            if written_word == reading: continue
            if 'を' in reading or ' ' in reading: continue

            # 4. Validar Nivel JLPT usando nuestra DB de Kanjis optimizados
            word_level = get_word_highest_jlpt_level(written_word, optimized_kanjis)
            if word_level is None: continue

            # 5. Validar Complejidad visual
            if not word_meets_complexity_criteria(written_word, word_level, optimized_kanjis): continue

            # --- SI PASA, LIMPIAMOS LA ESTRUCTURA ---
            
            # Simplificar variantes (solo necesitamos written y pronounced)
            simple_variants = [{'written': v.get('written'), 'pronounced': v.get('pronounced')} for v in variants]
            
            # Simplificar significados (solo glosses)
            simple_meanings = []
            for m in meanings:
                if 'glosses' in m:
                    simple_meanings.append({'glosses': m['glosses']})
            
            # Guardamos la entrada limpia
            valid_entries.append({
                'variants': simple_variants, 
                'meanings': simple_meanings
            })

        if valid_entries:
            optimized_words[word_key] = valid_entries
            count_valid_words += len(valid_entries)

    print(f"   ✅ Palabras retenidas: {count_valid_words} (de {total_raw_words} originales)")

    # 3. GUARDAR RESULTADO
    print(f"💾 Guardando archivo optimizado en: {OUTPUT_FILE} ...")
    
    output_data = {
        "kanjis": optimized_kanjis,
        "words": optimized_words
    }
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            # separators=(',', ':') elimina espacios en blanco para minificar el JSON
            json.dump(output_data, f, ensure_ascii=False, separators=(',', ':'))
        
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"🎉 ¡ÉXITO! Archivo generado correctamente.")
        print(f"📦 Tamaño final: {size_mb:.2f} MB")
        
    except Exception as e:
        print(f"❌ Error al guardar el archivo: {e}")

if __name__ == '__main__':
    main()
