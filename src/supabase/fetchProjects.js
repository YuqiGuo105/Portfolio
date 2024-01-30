import { useState, useEffect } from 'react';
import { supabase } from '../path_to_your_supabase_client';

const fetchProjects = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const { data, error } = await supabase.from('Projects').select('*');
                if (error) throw error;
                setProjects(data);
            } catch (error) {
                setError(error.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    return { projects, loading, error };
};

export default fetchProjects;
