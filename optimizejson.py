import json
import os
import sys
import argparse

# --- CONFIGURACIÓN DE DIFICULTAD ---
KOTOBA_KANJI_MAX_DIFFICULTY = {
    5: (6, 1, 10),   # (Max trazos kanji, Max grado, Max trazos totales)
    4: (8, 2, 15),
    3: (10, 4, 20),
    2: (12, 6, 24),
    1: (14, 8, 28),
}

# --- FUNCIONES DE AYUDA ---

def is_char_kanji(char):
    return '\u4e00' <= char <= '\u9faf'

def get_okurigana_ending(word):
    if not word: return ""
    ending = ""
    for char in reversed(word):
        # Rango Hiragana: 3041-3096
        if '\u3041' <= char <= '\u3096':
            ending = char + ending
        else:
            break
    return ending

def get_word_highest_jlpt_level(word_str, kanji_db):
    levels = []
    for char in word_str:
        if is_char_kanji(char):
            details = kanji_db.get(char)
            # En DB optimizada, el JLPT está en el índice 0
            if not details: return None 
            levels.append(details[0]) 
    if not levels: return None
    return min(levels)

def word_meets_complexity(word_str, target_level, kanji_db):
    thresholds = KOTOBA_KANJI_MAX_DIFFICULTY.get(target_level)
    if not thresholds: return False
    max_strokes_kanji, max_grade, max_total = thresholds
    total_strokes = 0

    for char in word_str:
        details = kanji_db.get(char)
        if not details: continue
        # DB Optimizada: [jlpt, grade, strokes, ...]
        strokes = details[2]
        grade = details[1] if details[1] is not None else 9
        
        if strokes > max_strokes_kanji or grade > max_grade: return False
        total_strokes += strokes

    return total_strokes <= max_total

# --- PROCESO PRINCIPAL ---

def main():
    # Configuración de Argumentos de Consola
    parser = argparse.ArgumentParser(description="Optimizar JSON de KanjiAPI para reducir tamaño y procesar datos.")
    
    # Argumento 1: Archivo de entrada (OBLIGATORIO)
    parser.add_argument("input_file", help="Ruta del archivo .json original (ej: kanjiapi_full.json)")
    
    # Argumento 2: Archivo de salida (OPCIONAL, por defecto 'kanjiapi_small.json')
    parser.add_argument("-o", "--output", default="kanjiapi_small.json", help="Nombre del archivo de salida (Default: kanjiapi_small.json)")

    args = parser.parse_args()

    input_path = args.input_file
    output_path = args.output

    # Validar existencia
    if not os.path.exists(input_path):
        print(f"❌ Error: El archivo '{input_path}' no existe.")
        sys.exit(1)

    print(f"📂 Leyendo: {input_path} ...")
    
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error al leer el JSON: {e}")
        sys.exit(1)

    full_kanjis = data.get('kanjis', {})
    full_words = data.get('words', {})
    
    print(f"📊 Datos originales cargados: {len(full_kanjis)} Kanjis, {len(full_words)} Palabras.")

    # --- 1. OPTIMIZAR KANJIS (Array Posicional) ---
    print("🔨 Optimizando Kanjis...")
    # Formato: KEY: [JLPT, Grade, Strokes, Meanings(str), Kun(list), On(list)]
    optimized_kanjis = {}
    
    for char, d in full_kanjis.items():
        jlpt = d.get('jlpt')
        if jlpt is None: continue
        
        meanings = "; ".join(d.get('meanings', [])[:3]) 
        kun = [r.replace('.', '') for r in d.get('kun_readings', []) if r]
        on = [r for r in d.get('on_readings', []) if r]
        
        optimized_kanjis[char] = [
            jlpt, 
            d.get('grade'), 
            d.get('stroke_count', 0), 
            meanings, 
            kun, 
            on
        ]

    # --- 2. OPTIMIZAR Y AGRUPAR PALABRAS ---
    print("🔨 Optimizando y agrupando Vocabulario...")
    vocab_by_level = {1: {}, 2: {}, 3: {}, 4: {}, 5: {}}
    unique_hashes = set()
    count_words = 0

    for word_list in full_words.values():
        for entry in word_list:
            variants = entry.get('variants', [])
            if not variants: continue
            
            w = variants[0].get('written')
            r = variants[0].get('pronounced')
            
            if not w or not r or w == r or ' ' in r or 'を' in r: continue
            if not any('\u4e00' <= c <= '\u9faf' for c in w): continue 
            if any('ァ' <= c <= 'ヶ' for c in w): continue

            level = get_word_highest_jlpt_level(w, optimized_kanjis)
            if level is None: continue

            if not word_meets_complexity(w, level, optimized_kanjis): continue

            m_list = entry.get('meanings', [])
            meaning = m_list[0]['glosses'][0] if m_list and 'glosses' in m_list[0] else ""
            
            unique_key = f"{w}|{r}|{meaning}"
            if unique_key in unique_hashes: continue
            unique_hashes.add(unique_key)

            ending = get_okurigana_ending(w)
            if ending not in vocab_by_level[level]:
                vocab_by_level[level][ending] = []
            
            # [Palabra, Lectura, Significado]
            vocab_by_level[level][ending].append([w, r, meaning])
            count_words += 1

    print(f"✅ Resultado: {len(optimized_kanjis)} Kanjis, {count_words} Palabras.")

    # --- 3. GUARDAR ---
    print(f"💾 Guardando en: {output_path} ...")
    final_data = { "k": optimized_kanjis, "v": vocab_by_level }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, separators=(',', ':'))
    
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"🎉 ¡ÉXITO! Tamaño final: {size_mb:.2f} MB")

if __name__ == '__main__':
    main()
